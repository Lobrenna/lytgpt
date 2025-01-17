// URL til FastAPI-backenden (lokal utvikling)
const API_BASE_URL = "http://localhost:8000";

// Elementer fra Webflow (juster ID-ene om nødvendig)
const modelSelector      = document.getElementById('model-selector');
const chatSelector       = document.getElementById('chat-selector');
const chatMessages       = document.getElementById('chat-messages');
const chatInput          = document.getElementById('chat-input');
const sendButton         = document.getElementById('send-button');
const uploadFilesInput   = document.querySelector('.w-file-upload-input');
const uploadFilesButton  = document.getElementById('upload-files-button');
const urlInput           = document.getElementById('url-input');
const setUrlButton       = document.getElementById('set-url-button');
const newChatButton      = document.getElementById('new-chat-button');
const deleteChatButton   = document.getElementById('delete-chat-button');
const deleteConfirmation = document.getElementById('delete-confirmation');
const deleteConfirmYes   = document.getElementById('delete-confirm-yes');
const deleteConfirmNo    = document.getElementById('delete-confirm-no');
const overlay            = document.getElementById('overlay');
const longContextInput   = document.getElementById('long-context-input');
const longContextButton  = document.getElementById('long-context-button');
const fileList           = document.getElementById('file-list');  // For å vise opplastede filer

// State
let currentChatId  = null;
let selectedModel  = null;

/**
 * Konfigurer marked.js for å integrere med Prism.js
 */
marked.setOptions({
    renderer: new marked.Renderer(),
    gfm: true,
    breaks: true,
    headerIds: false,
    langPrefix: 'language-', // Viktig for Prism
    highlight: function(code, lang) {
        if (lang && Prism.languages[lang]) {
            return Prism.highlight(code, Prism.languages[lang], lang);
        } else {
            // Standard språk hvis ikke spesifisert
            return Prism.highlight(code, Prism.languages.javascript, 'javascript');
        }
    }
});

/**
 * renderMarkdown(markdownText)
 *  - Bruker Marked.js til å parse all Markdown 
 *  - Returnerer ferdig HTML
 */
function renderMarkdown(markdownText) {
    return marked.parse(markdownText);
}

/**
 * appendMessageToChat(role, htmlContent)
 *  - Oppretter en <div> med klasser 'chat-message' + role
 *  - Legger inn 'htmlContent'
 *  - Kjører Prism.highlightElement for syntax highlighting
 */
function appendMessageToChat(role, htmlContent) {
    if (!chatMessages) {
        console.error("Chat messages element not found.");
        return;
    }
    const msgEl = document.createElement('div');
    msgEl.classList.add('chat-message', role);
    
    // Legg til pre-wrap styling for å bevare mellomrom og linjeskift
    msgEl.style.whiteSpace = 'pre-wrap';
    
    // Fjern <p> tags fra brukerens meldinger
    if (role === 'user') {
        htmlContent = htmlContent.replace(/<p>(.*?)<\/p>/g, '$1');
    }
    
    // Sjekk om innholdet ser ut som ren kode (ingen markdown)
    if (role === 'user' && !htmlContent.includes('</code>') && !htmlContent.includes('\n```')) {
        // Wrap innholdet i en kodeblokk hvis det ser ut som kode
        htmlContent = '```\n' + htmlContent + '\n```';
        // Konverter til markdown på nytt
        htmlContent = renderMarkdown(htmlContent);
    }
    
    msgEl.innerHTML = htmlContent;

    // Kjør syntax-highlighting for hvert <code> element
    const codeBlocks = msgEl.querySelectorAll('pre code');
    codeBlocks.forEach((block) => {
        Prism.highlightElement(block);
    });

    chatMessages.appendChild(msgEl);
    chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: 'smooth'
    });
}

/**
 * onSendMessage
 *  - Henter brukerens melding => viser urørt i chat => sender til backend => mottar svar => viser urørt
 */
async function onSendMessage() {
    if (!chatInput || !chatInput.value.trim()) return;

    const message = chatInput.value.trim();
    const fileInputs = document.querySelectorAll('.w-file-upload-input');
    
    console.log("Alle file inputs funnet:", fileInputs.length);
    
    // Samle alle filer som er valgt
    let hasFiles = false;
    const formData = new FormData();
    formData.append('message', message);
    
    // Samle alle filer fra inputs som har en fil valgt
    let fileCount = 0;
    fileInputs.forEach((input) => {
        const uploadDiv = input.closest('.w-file-upload');
        const successView = uploadDiv?.querySelector('.w-file-upload-success');
        
        if (input.files && 
            input.files[0] && 
            successView && 
            !successView.classList.contains('w-hidden')) {
            
            fileCount++;
            console.log(`Legger til fil ${fileCount}:`, input.files[0].name);
            formData.append('files', input.files[0]);
            hasFiles = true;
        }
    });
    
    // Vis brukerens melding
    appendMessageToChat('user', message);
    appendMessageToChat('assistant', 'Genererer svar...');

    try {
        let response;
        
        // Sjekk om vi har filer og skal bruke long-context
        if (hasFiles) {
            console.log("Sender request med filer til long-context endpoint");
            
            if (selectedModel) {
                console.log("Legger til modell:", selectedModel);
                formData.append('preferred_model', selectedModel);
            }

            // Debug: Vis innholdet i FormData
            for (let pair of formData.entries()) {
                console.log('FormData innhold:', pair[0], pair[1]);
            }

            response = await fetch(`${API_BASE_URL}/chat/long-context`, {
                method: 'POST',
                body: formData
            });
            
            console.log("Response status:", response.status);

            if (!response.ok) {
                const errorData = await response.json();
                console.error("Response error data:", errorData);
                throw new Error(`Nettverksfeil: ${response.status} ${response.statusText}\n${JSON.stringify(errorData)}`);
            }

            const data = await response.json();
            console.log("Response data:", data);
            
            // Fjern "Genererer svar..." meldingen
            chatMessages.removeChild(chatMessages.lastChild);
            
            // Vis modellinfo og svar
            const modelInfo = `Modell: ${data.selected_model} | Kontekst: ${formatFileSize(data.context_length)} | Est. tokens: ${data.estimated_tokens}`;
            appendMessageToChat('system', modelInfo);
            appendMessageToChat('assistant', data.response);
            
            // Tøm chat input
            chatInput.value = '';
            
            // IKKE fjern file uploads her - la brukeren fjerne dem manuelt
            
        } else {
            // Vanlig chat uten filer
            if (!currentChatId) {
                currentChatId = await createNewChat();
            }
            
            if (!currentChatId) {
                throw new Error('Kunne ikke opprette ny chat');
            }

            response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(currentChatId)}/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    model: selectedModel
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error("Response error data:", errorData);
                throw new Error(`Nettverksfeil: ${response.status} ${response.statusText}\n${JSON.stringify(errorData)}`);
            }

            const data = await response.json();
            chatMessages.removeChild(chatMessages.lastChild);
            appendMessageToChat('assistant', data.response);
            chatInput.value = '';
        }

    } catch (error) {
        console.error('Feil ved sending av melding:', error);
        console.error('Full error object:', error);
        if (chatMessages.lastElementChild) {
            chatMessages.lastElementChild.remove();
        }
        appendMessageToChat('error', error.message);
    }
}

// Hjelpefunksjon for å formatere filstørrelse
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * displayChatMessages
 *  - Viser en hel liste av meldinger for en chat, urørt
 */
function displayChatMessages(messages) {
    clearChatMessages();
    messages.forEach(msg => {
        // Ingen fjerning av anførselstegn
        const content = msg.content;  
        const html    = renderMarkdown(content);
        appendMessageToChat(msg.role, html);
    });
}

function clearChatMessages() {
    if (!chatMessages) {
        console.error("Chat messages element not found.");
        return;
    }
    chatMessages.innerHTML = '';
}

/**
 * createNewChat - Opprett en ny chat i backend
 */
async function createNewChat() {
    try {
        if ((!selectedModel || selectedModel === '') && modelSelector && modelSelector.options.length > 0) {
            selectedModel = modelSelector.options[0].value;
        }
        console.log("Oppretter ny chat med modell:", selectedModel);
        
        const response = await fetch(`${API_BASE_URL}/chats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                title: "Ny chat",
                model: selectedModel 
            })
        });
        
        if (response.ok) {
            const chat = await response.json();
            currentChatId = chat.title;
            
            // Oppdater model selector
            if (modelSelector) {
                modelSelector.value = selectedModel;
            }
            
            // Oppdater chat list
            await fetchChats();
            
            // Last inn den nye chatten
            await loadChat(currentChatId);
            
            appendMessageToChat("assistant", "Ny chat opprettet. Hvordan kan jeg hjelpe deg?");
            console.log("Ny chat opprettet med ID:", currentChatId);
            
            // Sett valgt chat i selector
            if (chatSelector) {
                chatSelector.value = currentChatId;
            }
            
            return currentChatId;
        } else {
            throw new Error(`Server svarte med ${response.status}`);
        }
    } catch (error) {
        console.error("Feil ved opprettelse av chat:", error);
        throw error;
    }
}

/**
 * loadChat - Laster en eksisterende chat
 */
async function loadChat(chatId) {
    try {
        // Rydd opp i file uploads først
        cleanupFileUploads();
        
        const response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chatId)}`);
        if (response.ok) {
            const chat = await response.json();
            currentChatId = chat.title;
            // Oppdater modellvalg
            selectedModel = chat.model;
            if (modelSelector) {
                modelSelector.value = chat.model;
            }
            displayChatMessages(chat.messages);
            console.log("Lastet chat med ID:", currentChatId, "Modell:", selectedModel);
        } else {
            console.error("Feil ved lasting av chat:", response.status, response.statusText);
            alert("Feil ved lasting av chat.");
        }
    } catch (error) {
        console.error("Feil ved lasting av chat:", error);
        alert("Feil ved lasting av chat.");
    }
}

/**
 * fetchModels - Hent tilgjengelige modeller
 */
async function fetchModels() {
    try {
        const response = await fetch(`${API_BASE_URL}/models`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const models = await response.json();
        populateModelSelector(models);
    } catch (error) {
        console.error("Feil ved henting av modeller:", error);
    }
}

function populateModelSelector(models) {
    if (!modelSelector) return;
    modelSelector.innerHTML = '';
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.text  = m;
        modelSelector.appendChild(opt);
    });
    if (models.length > 0 && !selectedModel) {
        selectedModel      = models[0];
        modelSelector.value = selectedModel;
    }
}

/**
 * fetchChats - Hent tilgjengelige chats
 */
async function fetchChats() {
    try {
        const response = await fetch(`${API_BASE_URL}/chats`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const chats = await response.json();
        console.log('Mottatte chats fra backend:', chats); // Debug
        
        if (chatSelector) {
            // Tøm eksisterende options
            chatSelector.innerHTML = '';
            
            // Legg til "Ny chat" option
            const newChatOption = document.createElement('option');
            newChatOption.value = "new";
            newChatOption.text = "Ny chat";
            chatSelector.appendChild(newChatOption);
            
            // Legg til eksisterende chats
            chats.forEach(chat => {
                if (chat !== "Ny chat") { // Unngå duplikat av "Ny chat"
                    const opt = document.createElement('option');
                    opt.value = chat;
                    opt.text = chat;
                    chatSelector.appendChild(opt);
                }
            });
            
            // Sett riktig valgt verdi
            if (currentChatId) {
                chatSelector.value = currentChatId;
                loadChat(currentChatId);
            } else {
                chatSelector.value = "new";
                currentChatId = null;
                clearChatMessages();
            }
        } else {
            console.error('Chat selector ikke funnet i DOM');
        }
    } catch (error) {
        console.error('Feil ved henting av chats:', error);
    }
}

function populateChatSelector(chats) {
    if (!chatSelector) return;
    chatSelector.innerHTML = '';
    chats.forEach(chat => {
        const opt = document.createElement('option');
        opt.value = (chat === "Ny chat") ? "new" : chat;
        opt.text  = chat;
        chatSelector.appendChild(opt);
    });
    if (currentChatId) {
        chatSelector.value = currentChatId;
        loadChat(currentChatId);
    } else {
        chatSelector.value = "new";
        currentChatId      = null;
        clearChatMessages();
    }
}

/**
 * onModelChange - Håndterer endring av modell
 */
async function onModelChange(event) {
    const newModel = event.target.value;
    console.log("Forsøker å endre modell til:", newModel);

    if (!currentChatId) {
        selectedModel = newModel;
        console.log("Ingen aktiv chat, bare oppdaterer lokal modell til:", selectedModel);
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(currentChatId)}/model`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: newModel
            })
        });

        if (response.ok) {
            selectedModel = newModel;
            console.log("Modell endret til:", selectedModel);
        } else {
            console.error("Feil ved endring av modell:", response.status);
            event.target.value = selectedModel; // Tilbakestill til forrige modell
            alert("Feil ved endring av modell.");
        }
    } catch (error) {
        console.error("Feil ved endring av modell:", error);
        event.target.value = selectedModel; // Tilbakestill til forrige modell
        alert("Feil ved endring av modell.");
    }
}

async function onChatChange(e) {
    const chosen = e.target.value;
    if (chosen === "new") {
        await createNewChat();
    } else {
        await loadChat(chosen);
    }
}

/**
 * onUploadFiles - Filopplasting
 */
async function onUploadFiles() {
    console.log("Upload-knapp klikket");
    if (!currentChatId) {
        alert("Vennligst velg eller opprett en chat først.");
        return;
    }

    const fileInputs = document.querySelectorAll('.w-file-upload-input');
    if (!fileInputs || fileInputs.length === 0) return;

    let hasFiles = false;
    const formData = new FormData();
    
    fileInputs.forEach((input, index) => {
        if (input.files && input.files[0]) {
            formData.append(`file${index + 1}`, input.files[0]);
            hasFiles = true;
        }
    });

    if (!hasFiles) {
        alert("Vennligst velg filer å laste opp.");
        return;
    }

    console.log("FormData klar, sender nå til backend...");

    try {
        const resp = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(currentChatId)}/context/files`, {
            method: 'POST',
            body: formData
        });
        if (!resp.ok) {
            console.error("Feil ved opplasting av filer:", resp.status, resp.statusText);
            alert("Feil ved opplasting av filer.");
            return;
        }
        const data = await resp.json();
        console.log("Respons fra server:", data);
        alert(data.message);
        
        // Tøm alle file inputs
        fileInputs.forEach(input => {
            input.value = '';
        });
    } catch (error) {
        console.error("Feil ved opplasting av filer:", error);
        alert("Feil ved opplasting av filer.");
    }
}

/**
 * onSetUrl - Legg til URL-kontekst
 */
async function onSetUrl() {
    if (!currentChatId) {
        alert("Vennligst velg eller opprett en chat først.");
        return;
    }

    const url = urlInput.value.trim();
    const maxDepth = 1;
    if (!url) {
        alert("Vennligst skriv inn en URL.");
        return;
    }

    const formData = new FormData();
    formData.append('url', url);
    formData.append('max_depth', maxDepth);

    try {
        const resp = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(currentChatId)}/context/url`, {
            method: 'POST',
            body: formData
        });
        if (!resp.ok) {
            console.error("Feil ved innstilling av URL:", resp.status, resp.statusText);
            alert("Feil ved innstilling av URL.");
            return;
        }
        const data = await resp.json();
        alert(data.message);
        urlInput.value = '';
    } catch (error) {
        console.error("Feil ved innstilling av URL:", error);
        alert("Feil ved innstilling av URL.");
    }
}

/**
 * onNewChat
 */
async function onNewChat() {
    try {
        const response = await fetch(`${API_BASE_URL}/chats`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: "Ny chat",
                model: selectedModel || "gpt-4o"  // Bruk valgt modell eller default
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const chatData = await response.json();
        currentChatId = chatData.title;
        
        // Oppdater chat selector
        await fetchChats();
        if (chatSelector) {
            chatSelector.value = currentChatId;
        }
        
        // Tøm meldinger
        if (chatMessages) {
            chatMessages.innerHTML = '';
        }

        console.log("Ny chat opprettet med ID:", currentChatId);
    } catch (error) {
        console.error("Feil ved opprettelse av ny chat:", error);
        alert("Feil ved opprettelse av ny chat.");
    }
}

/**
 * onDeleteChat
 */
function onDeleteChat() {
    if (!currentChatId) {
        alert("Vennligst velg en chat å slette.");
        return;
    }
    if (deleteConfirmation && overlay) {
        deleteConfirmation.style.display = 'block';
        overlay.style.display            = 'block';
    }
}

async function onConfirmDelete() {
    try {
        const resp = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(currentChatId)}`, {
            method: 'DELETE'
        });
        if (!resp.ok) {
            console.error("Feil ved sletting av chat:", resp.status, resp.statusText);
            alert("Feil ved sletting av chat.");
            return;
        }
        const data = await resp.json();
        alert(data.message);
        fetchChats();
        clearChatMessages();
        currentChatId = null;
        selectedModel = null;
        if (modelSelector) {
            modelSelector.value = '';
        }
        if (deleteConfirmation && overlay) {
            deleteConfirmation.style.display = 'none';
            overlay.style.display            = 'none';
        }
    } catch (error) {
        console.error("Feil ved sletting av chat:", error);
        alert("Feil ved sletting av chat.");
    }
}

function onCancelDelete() {
    if (deleteConfirmation && overlay) {
        deleteConfirmation.style.display = 'none';
        overlay.style.display            = 'none';
    }
}

/**
 * setupEventListeners
 */
function setupEventListeners() {
    console.log('Setting up event listeners');
    console.log('Chat selector:', chatSelector);
    
    if (modelSelector) {
        modelSelector.addEventListener('change', onModelChange);
    }
    
    // Sjekk og sett opp chat selector
    if (chatSelector) {
        console.log('Setter opp chat selector event listener');
        chatSelector.addEventListener('change', onChatChange);
    } else {
        console.error('Chat selector ikke funnet ved setup av event listeners');
    }
    
    if (sendButton) {
        sendButton.addEventListener('click', onSendMessage);
        sendButton.setAttribute('type', 'button');
    }
    if (uploadFilesButton) {
        uploadFilesButton.addEventListener('click', onUploadFiles);
    }
    if (setUrlButton) {
        setUrlButton.addEventListener('click', onSetUrl);
    }
    if (newChatButton) {
        newChatButton.addEventListener('click', onNewChat);
    }
    if (deleteChatButton) {
        deleteChatButton.addEventListener('click', onDeleteChat);
    }
    if (deleteConfirmYes) {
        deleteConfirmYes.addEventListener('click', onConfirmDelete);
    }
    if (deleteConfirmNo) {
        deleteConfirmNo.addEventListener('click', onCancelDelete);
    }

    // ENTER-tasten i chatInput
    if (chatInput) {
        chatInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSendMessage();
            }
        });
    }

    if (longContextButton) {
        longContextButton.addEventListener('click', handleLongContextSubmit);
    }

    if (longContextInput) {
        longContextInput.addEventListener('change', handleFileSelection);
    }

    // Legg til event listener for file selection på det første file input elementet
    const initialFileInput = document.querySelector('.w-file-upload-input');
    if (initialFileInput) {
        initialFileInput.addEventListener('change', handleFileSelection);
    }

    // Initialiser Webflow's file upload funksjonalitet
    window.Webflow && window.Webflow.destroy();
    window.Webflow && window.Webflow.ready();
    window.Webflow && window.Webflow.require('ix2').init();
}

/**
 * handleFileSelection - Håndterer når en fil velges
 */
function handleFileSelection(event) {
    console.log("File selection triggered");
    
    const fileUploadDiv = event.target.closest('.w-file-upload');
    if (!fileUploadDiv) {
        console.log("Fant ikke fileUploadDiv");
        return;
    }

    const formBlock = document.querySelector('.form-block-2');
    if (!formBlock) {
        console.log("Fant ikke form-block-2");
        return;
    }

    const allFileUploads = document.querySelectorAll('.w-file-upload');
    console.log("Antall file uploads:", allFileUploads.length);
    
    if (allFileUploads.length >= 5) {
        console.log("Maks antall file uploads nådd");
        return;
    }

    // Lag nytt upload element med en gang en fil er valgt
    if (event.target.files && event.target.files[0]) {
        console.log("Fil valgt:", event.target.files[0].name);
        
        // Oppdater UI for den valgte filen
        const file = event.target.files[0];
        const defaultView = fileUploadDiv.querySelector('.w-file-upload-default');
        const successView = fileUploadDiv.querySelector('.w-file-upload-success');
        const fileNameDiv = fileUploadDiv.querySelector('.w-file-upload-file-name');
        
        if (defaultView && successView && fileNameDiv) {
            defaultView.classList.add('w-hidden');
            successView.classList.remove('w-hidden');
            fileNameDiv.textContent = file.name;
            console.log("UI oppdatert for fil:", file.name);
        }

        // Lag et nytt upload element umiddelbart
        console.log("Lager nytt upload element");
        const newUploadDiv = document.createElement('div');
        newUploadDiv.className = 'w-file-upload';
        newUploadDiv.innerHTML = `
            <div class="w-file-upload-default">
                <input class="w-file-upload-input" 
                    accept=".ai, .doc, .docx, .indd, .key, .numbers, .pps, .ppt, .pptx, .psd, .ods, .odt, .odp, .pages, .pdf, .txt, .xls, .xlsx, .csv, .pkl" 
                    name="file" 
                    data-name="File" 
                    type="file" 
                    id="file-${allFileUploads.length + 1}" 
                    style="height: 43.4766px; width: 1px;">
                <label for="file-${allFileUploads.length + 1}" 
                    role="button" 
                    class="button-3 w-file-upload-label">
                    <div class="w-icon-file-upload-icon"></div>
                    <div class="text w-inline-block">Upload File</div>
                </label>
                <div class="w-file-upload-info">Max file size 10MB.</div>
            </div>
            <div class="w-file-upload-uploading w-hidden">
                <div class="w-file-upload-uploading-btn">
                    <svg class="w-icon-file-upload-uploading" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30">
                        <path fill="currentColor" opacity=".2" d="M15 30a15 15 0 1 1 0-30 15 15 0 0 1 0 30zm0-3a12 12 0 1 0 0-24 12 12 0 0 0 0 24z"></path>
                        <path fill="currentColor" opacity=".75" d="M0 15A15 15 0 0 1 15 0v3A12 12 0 0 0 3 15H0z">
                            <animateTransform attributeName="transform" attributeType="XML" dur="0.6s" from="0 15 15" repeatCount="indefinite" to="360 15 15" type="rotate"></animateTransform>
                        </path>
                    </svg>
                    <div class="w-inline-block">Uploading...</div>
                </div>
            </div>
            <div class="w-file-upload-success w-hidden">
                <div class="w-file-upload-file">
                    <div class="w-file-upload-file-name"></div>
                    <div role="button" class="w-file-remove-link">
                        <div class="w-icon-file-upload-remove"></div>
                    </div>
                </div>
            </div>
            <div class="w-file-upload-error w-hidden">
                <div class="w-file-upload-error-msg" 
                    data-w-size-error="Upload failed. Max size for files is 10 MB." 
                    data-w-type-error="Upload failed. Invalid file type." 
                    data-w-generic-error="Upload failed. Something went wrong. Please retry.">
                    Upload failed. Max size for files is 10 MB.
                </div>
            </div>`;

        // Legg til event listener på det nye input elementet
        const newInput = newUploadDiv.querySelector('.w-file-upload-input');
        if (newInput) {
            console.log("Legger til event listener på nytt input element");
            newInput.addEventListener('change', handleFileSelection);
        }
        
        // Legg til event listener for remove-knappen
        const removeButton = newUploadDiv.querySelector('.w-file-remove-link');
        if (removeButton) {
            removeButton.addEventListener('click', function() {
                console.log("Remove knapp klikket");
                const defaultView = newUploadDiv.querySelector('.w-file-upload-default');
                const successView = newUploadDiv.querySelector('.w-file-upload-success');
                if (defaultView && successView) {
                    defaultView.classList.remove('w-hidden');
                    successView.classList.add('w-hidden');
                }
                newInput.value = '';
            });
        }

        // Sett inn det nye elementet etter det nåværende elementet
        console.log("Setter inn nytt element etter gjeldende element");
        fileUploadDiv.parentNode.insertBefore(newUploadDiv, fileUploadDiv.nextSibling);
    }
}

// Vis valgte filer
function updateFileList(filenames) {
    const fileList = document.getElementById('file-list');
    if (!fileList) return;

    fileList.innerHTML = '';
    
    filenames.forEach(filename => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        // Bestem filtype (scrape eller upload)
        const isScrapedFile = filename.includes('saved_scrapes');
        const displayName = isScrapedFile ? 
            filename.split('/').pop().replace('.txt', '') : 
            filename.split('/').pop();

        // Lag HTML for file item
        fileItem.innerHTML = `
            <div class="file-info">
                <span class="file-name">${displayName}</span>
                <span class="file-type">${isScrapedFile ? '🌐' : '📄'}</span>
            </div>
            <div class="file-actions">
                <button class="file-action-btn" data-action="use">Bruk</button>
                <button class="file-action-btn" data-action="remove">×</button>
            </div>
        `;

        // Legg til event listeners
        const useBtn = fileItem.querySelector('[data-action="use"]');
        const removeBtn = fileItem.querySelector('[data-action="remove"]');

        useBtn.addEventListener('click', () => useFileAsContext(filename));
        removeBtn.addEventListener('click', () => removeFile(filename));

        fileList.appendChild(fileItem);
    });
}

/**
 * useFileAsContext
 * - Setter valgt fil som aktiv kontekst
 */
async function useFileAsContext(filename) {
    try {
        const response = await fetch(`${API_BASE_URL}/chats/${currentChatId}/context/file`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ filename })
        });

        if (!response.ok) throw new Error('Kunne ikke sette kontekst');

        appendMessageToChat('system', `Satt ${filename.split('/').pop()} som aktiv kontekst`);
        updateActiveContext(filename);
    } catch (error) {
        console.error('Feil ved setting av kontekst:', error);
        appendMessageToChat('error', 'Kunne ikke sette kontekst');
    }
}

/**
 * updateActiveContext
 * - Viser hvilken fil/URL som er aktiv kontekst
 */
function updateActiveContext(filename) {
    const urlInput = document.getElementById('url-input');
    if (!urlInput) return;

    if (filename.includes('saved_scrapes')) {
        // Les URL fra filen og vis den
        fetch(`${API_BASE_URL}/files/${encodeURIComponent(filename)}/metadata`)
            .then(response => response.json())
            .then(metadata => {
                urlInput.textContent = metadata.url || 'Enter URL to scrape ...';
                urlInput.classList.add('active-context');
            })
            .catch(() => {
                urlInput.textContent = 'Enter URL to scrape ...';
                urlInput.classList.remove('active-context');
            });
    } else {
        urlInput.textContent = 'Enter URL to scrape ...';
        urlInput.classList.remove('active-context');
    }
}

// Håndter long-context innsending
async function handleLongContextSubmit() {
    if (!chatInput || !longContextInput) return;

    const message = chatInput.value.trim();
    if (!message) {
        alert('Vennligst skriv inn en melding');
        return;
    }

    const files = longContextInput.files;
    if (!files || files.length === 0) {
        alert('Vennligst velg minst én fil');
        return;
    }

    // Vis laster-indikator
    appendMessageToChat('user', message);
    appendMessageToChat('assistant', 'Behandler filer og genererer svar...');

    const formData = new FormData();
    formData.append('message', message);
    Array.from(files).forEach(file => {
        formData.append('files', file);
    });
    
    if (selectedModel) {
        formData.append('preferred_model', selectedModel);
    }

    try {
        const response = await fetch(`${API_BASE_URL}/chat/long-context`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Nettverksfeil');
        }

        const data = await response.json();
        
        // Fjern laster-meldingen
        chatMessages.removeChild(chatMessages.lastChild);
        
        // Vis modellinfo og svar
        const modelInfo = `Modell: ${data.selected_model} | Kontekst: ${formatFileSize(data.context_length)} | Est. tokens: ${data.estimated_tokens}`;
        appendMessageToChat('system', modelInfo);
        appendMessageToChat('assistant', data.response);

        // Tøm input
        chatInput.value = '';
        longContextInput.value = '';
        fileList.innerHTML = '';

    } catch (error) {
        console.error('Feil ved long-context forespørsel:', error);
        chatMessages.removeChild(chatMessages.lastChild);
        appendMessageToChat('error', 'Det oppstod en feil ved behandling av forespørselen.');
    }
}

/**
 * cleanupFileUploads
 */
function cleanupFileUploads() {
    console.log("Starter cleanupFileUploads");
    
    // Finn den spesifikke formen for file uploads (den med Context file upload label)
    const fileUploadForm = Array.from(document.querySelectorAll('.form-block-2.w-form'))
        .find(form => {
            const label = form.querySelector('label');
            return label && label.textContent === 'Context file upload';
        });

    if (!fileUploadForm) {
        console.log("Fant ikke file upload form");
        return;
    }

    // Tøm innholdet i formen, men behold label
    const label = fileUploadForm.querySelector('label');
    const form = fileUploadForm.querySelector('form');
    if (form) {
        form.innerHTML = '';
        if (label) {
            form.appendChild(label);
        }

        // Opprett ett nytt file-upload element
        const newUploadDiv = document.createElement('div');
        newUploadDiv.className = 'w-file-upload';
        newUploadDiv.innerHTML = `
            <div class="w-file-upload-default">
                <input class="w-file-upload-input" 
                    accept=".ai, .doc, .docx, .indd, .key, .numbers, .pps, .ppt, .pptx, .psd, .ods, .odt, .odp, .pages, .pdf, .txt, .xls, .xlsx, .csv, .pkl" 
                    name="file" 
                    data-name="File" 
                    type="file" 
                    id="file-1">
                <label for="file-1" 
                    role="button" 
                    class="button-3 w-file-upload-label">
                    <div class="w-icon-file-upload-icon"></div>
                    <div class="text w-inline-block">Upload File</div>
                </label>
                <div class="w-file-upload-info">Max file size 10MB.</div>
            </div>
            <div class="w-file-upload-uploading w-hidden">
                <div class="w-file-upload-uploading-btn">
                    <svg class="w-icon-file-upload-uploading" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30">
                        <path fill="currentColor" opacity=".2" d="M15 30a15 15 0 1 1 0-30 15 15 0 0 1 0 30zm0-3a12 12 0 1 0 0-24 12 12 0 0 0 0 24z"></path>
                        <path fill="currentColor" opacity=".75" d="M0 15A15 15 0 0 1 15 0v3A12 12 0 0 0 3 15H0z">
                            <animateTransform attributeName="transform" attributeType="XML" dur="0.6s" from="0 15 15" repeatCount="indefinite" to="360 15 15" type="rotate"></animateTransform>
                        </path>
                    </svg>
                    <div class="w-inline-block">Uploading...</div>
                </div>
            </div>
            <div class="w-file-upload-success w-hidden">
                <div class="w-file-upload-file">
                    <div class="w-file-upload-file-name"></div>
                    <div role="button" class="w-file-remove-link">
                        <div class="w-icon-file-upload-remove"></div>
                    </div>
                </div>
            </div>
            <div class="w-file-upload-error w-hidden">
                <div class="w-file-upload-error-msg" 
                    data-w-size-error="Upload failed. Max size for files is 10 MB." 
                    data-w-type-error="Upload failed. Invalid file type." 
                    data-w-generic-error="Upload failed. Something went wrong. Please retry.">
                    Upload failed. Max size for files is 10 MB.
                </div>
            </div>`;

        // Legg til event listener på det nye input elementet
        const newInput = newUploadDiv.querySelector('.w-file-upload-input');
        if (newInput) {
            console.log("Legger til event listener på nytt input");
            newInput.addEventListener('change', handleFileSelection);
        }

        // Legg til det nye elementet i formen
        form.appendChild(newUploadDiv);
    }
}

/**
 * handleNewChat - Oppdatert for å bruke cleanupFileUploads
 */
async function handleNewChat() {
    try {
        console.log("Starter handleNewChat");
        
        // Reset chat messages
        if (chatMessages) {
            chatMessages.innerHTML = '';
        }
        
        // Reset chat input
        if (chatInput) {
            chatInput.value = '';
        }

        // Rydd opp i file uploads
        cleanupFileUploads();

        // Opprett ny chat
        await createNewChat();
        
        // Oppdater UI
        updateUIForNewChat();

    } catch (error) {
        console.error('Feil ved opprettelse av ny chat:', error);
        appendMessageToChat('error', 'Det oppstod en feil ved opprettelse av ny chat.');
    }
}

/**
 * handleUrlScraping
 */
async function handleUrlScraping() {
    try {
        const urlInput = document.getElementById('url-input');
        let url = urlInput.value.trim();
        
        if (!url || url === 'Enter URL to scrape ...') {
            appendMessageToChat('error', 'Vennligst skriv inn en URL');
            return;
        }

        // Sjekk om input er gyldig
        if (!isValidUrl(url)) {
            appendMessageToChat('error', 'Ugyldig URL-format');
            return;
        }

        // Hvis ingen aktiv chat, opprett ny
        if (!currentChatId) {
            try {
                currentChatId = await createNewChat();
                console.log("Opprettet ny chat med ID:", currentChatId);

                if (!currentChatId) {
                    throw new Error('Chat ID ikke satt etter opprettelse');
                }

                // Oppdater chat selector
                await fetchChats();

            } catch (error) {
                console.error('Feil ved opprettelse av chat:', error);
                appendMessageToChat('error', `Kunne ikke opprette ny chat: ${error.message}`);
                return;
            }
        }

        appendMessageToChat('assistant', 'Scraper URL og analyserer innhold...');

        url = normalizeUrl(url);
        console.log('Normalisert URL:', url);
        console.log('Bruker chat ID:', currentChatId);

        const scrapeFormData = new FormData();
        scrapeFormData.append('url', url);
        scrapeFormData.append('max_depth', 1);

        const encodedChatId = encodeURIComponent(currentChatId);
        const scrapeResponse = await fetch(`${API_BASE_URL}/chats/${encodedChatId}/context/url`, {
            method: 'POST',
            body: scrapeFormData
        });

        if (!scrapeResponse.ok) {
            const errorText = await scrapeResponse.text();
            throw new Error(`Feil ved scraping (${scrapeResponse.status}): ${errorText}`);
        }

        const scrapeResult = await scrapeResponse.json();
        
        if (!scrapeResult.filenames || scrapeResult.filenames.length === 0) {
            throw new Error('Ingen fil returnert fra scraping');
        }

        console.log('Scrapet fil:', scrapeResult.filenames[0]);
        
        // Vent litt for å sikre at filen er lagret
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Oppdater file list og aktiv kontekst
        const filesResponse = await fetch(`${API_BASE_URL}/chats/${encodedChatId}/files`);
        const filesData = await filesResponse.json();
        updateFileList(filesData.files);

        // Reset input og vis status
        urlInput.value = '';
        
        // Fjern loading message
        if (chatMessages.lastElementChild) {
            chatMessages.lastElementChild.remove();
        }
        
        appendMessageToChat('system', 'URL scrapet og lagret som kontekst');

        // Vent litt til før vi sender meldingen
        await new Promise(resolve => setTimeout(resolve, 500));

        // Sett meldingen i input og send
        if (chatInput && currentChatId) {
            const message = "Lag en kort beskrivelse av nettstedets innhold over 3 til 4 avsnitt. Inkludere i denne kontaktopplysninger og eventuelt firmaopplysninger som finnes";
            
            appendMessageToChat('user', message);
            appendMessageToChat('assistant', 'Analyserer innhold...');
            
            // Debug logging
            console.log('Sender melding til chat:', currentChatId);
            
            // Bruk samme endepunkt som i onSendMessage
            const apiUrl = `${API_BASE_URL}/chats/${encodedChatId}/message`;
            console.log('API URL:', apiUrl);
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    model: selectedModel
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server respons:', errorText);
                throw new Error(`Kunne ikke sende melding: ${response.status}\n${errorText}`);
            }

            const data = await response.json();
            
            // Fjern "Analyserer innhold..." meldingen
            if (chatMessages.lastElementChild) {
                chatMessages.lastElementChild.remove();
            }
            
            appendMessageToChat('assistant', data.response);
        }

    } catch (error) {
        console.error('Feil ved scraping/analyse av URL:', error);
        if (chatMessages.lastElementChild) {
            chatMessages.lastElementChild.remove();
        }
        appendMessageToChat('error', `Det oppstod en feil: ${error.message}`);
    }
}

/**
 * setupUrlInput
 * - Setter opp event handlers for URL input
 */
function setupUrlInput() {
    const urlInput = document.getElementById('url-input');
    const setUrlButton = document.getElementById('set-url-button');

    if (urlInput && setUrlButton) {
        // Håndter ENTER keypress
        urlInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault(); // Hindre form submission
                handleUrlScraping();
            }
        });

        // Håndter scrape button click
        setUrlButton.addEventListener('click', function(e) {
            e.preventDefault(); // Hindre link navigation
            handleUrlScraping();
        });
    }
}

/**
 * normalizeUrl
 * - Konverterer ulike URL-formater til standard format
 * - Støtter: domain.no, www.domain.no, http(s)://(www.)domain.no
 */
function normalizeUrl(url) {
    // Fjern whitespace
    url = url.trim();
    
    // Hvis URL ikke inneholder protokoll (http/https)
    if (!url.match(/^https?:\/\//i)) {
        // Hvis URL ikke starter med www.
        if (!url.startsWith('www.')) {
            url = 'www.' + url;
        }
        url = 'https://' + url;
    }
    
    // Sørg for at vi bruker https
    url = url.replace(/^http:\/\//i, 'https://');
    
    return url;
}

/**
 * isValidUrl
 * - Sjekker om input er et gyldig domene/URL
 */
function isValidUrl(input) {
    // Tillat basic domener (f.eks. "cpm.no")
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
    
    // Tillat www-prefiks
    const wwwRegex = /^www\.[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
    
    // Tillat full URL
    const urlRegex = /^https?:\/\/(www\.)?[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
    
    return domainRegex.test(input) || 
            wwwRegex.test(input) || 
            urlRegex.test(input);
}

/**
 * DOMContentLoaded => fetchModels, fetchChats, setupEventListeners
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log("Upload files input:", uploadFilesInput);  // Debug: Se om elementet finnes
    console.log("Upload files button:", uploadFilesButton);  // Debug: Se om knappen finnes
    
    fetchModels();
    fetchChats();
    setupEventListeners();

    if (chatInput) {
        chatInput.style.color = "#000";
    }

    setupUrlInput();
});
