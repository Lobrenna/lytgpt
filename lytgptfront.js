// URL til FastAPI-backenden (oppdater hvis nødvendig)
const API_BASE_URL = "http://localhost:8000";

// Elementer fra DOM
const modelSelector = document.getElementById('model-selector');
const chatSelector = document.getElementById('chat-selector');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const uploadFilesButton = document.getElementById('upload-files-button');
const urlInput = document.getElementById('url-input');
const setUrlButton = document.getElementById('set-url-button');
const newChatButton = document.getElementById('new-chat-button');
const deleteChatButton = document.getElementById('delete-chat-button');
const deleteConfirmation = document.getElementById('delete-confirmation');
const deleteConfirmYes = document.getElementById('delete-confirm-yes');
const deleteConfirmNo = document.getElementById('delete-confirm-no');
const overlay = document.getElementById('overlay');
const fileList = document.getElementById('file-list'); // For å vise opplastede filer

// State
let currentChatId = null;
let selectedModel = null;

// Konfigurer marked.js for å integrere med Prism.js
const renderer = new marked.Renderer();

// Tilpass renderer for å unngå overflødige p-tagger
renderer.listitem = function(text) {
  // Fjern p-tagger fra listeelementer hvis de starter og slutter med dem
  if (text.startsWith('<p>') && text.endsWith('</p>')) {
    text = text.slice(3, -4);
  }
  return `<li>${text}</li>`;
};

renderer.paragraph = function(text) {
  // Unngå å wrappe enkle linjer i p-tagger hvis de er del av en liste
  if (text.includes('<ul>') || text.includes('<ol>')) {
    return text;
  }
  return `<p>${text}</p>`;
};

marked.setOptions({
  renderer: renderer,
  gfm: true,
  breaks: true,
  headerIds: false,
  langPrefix: 'language-', // Viktig for Prism
  highlight: function (code, lang) {
    if (lang && Prism.languages[lang]) {
      return Prism.highlight(code, Prism.languages[lang], lang);
    } else {
      return Prism.highlight(code, Prism.languages.javascript, 'javascript');
    }
  }
});

/**
 * renderMarkdown(markdownText)
 *  - Bruker Marked.js til å parse all Markdown 
 *  - Returnerer ferdig HTML med forbedret formatering
 */
function renderMarkdown(markdownText) {
  if (typeof markdownText !== 'string') {
    console.warn('Invalid markdown input:', markdownText);
    return '';
  }
  
  let html = marked.parse(markdownText);
  
  // Fjern eventuelle gjenværende doble linjeskift
  html = html.replace(/\n\s*\n/g, '\n');
  
  // Fjern overflødige p-tagger rundt lister
  html = html.replace(/<p>(\s*<[uo]l>)/g, '$1');
  html = html.replace(/(<\/[uo]l>\s*)<\/p>/g, '$1');
  
  return html;
}

/**
 * showSpinner - Viser en spinner og en melding på en knapp
 * @param {HTMLElement} buttonElement - Knappen hvor spinneren skal vises
 * @param {string} message - Meldingen som skal vises ved siden av spinneren
 */
function showSpinner(buttonElement, message) {
  if (!buttonElement) return;

  // Lagre original innhold
  buttonElement.dataset.originalText = buttonElement.innerHTML;

  // Sett spinner og melding
  buttonElement.innerHTML = `
    <span class="spinner"></span>${message}
  `;

  // Deaktiver knappen
  buttonElement.disabled = true;
}

/**
 * hideSpinner - Skjuler spinneren og gjenoppretter knappens opprinnelige innhold
 * @param {HTMLElement} buttonElement - Knappen hvor spinneren skal skjules
 */
function hideSpinner(buttonElement) {
  if (!buttonElement) return;

  // Gjenopprett original innhold
  buttonElement.innerHTML = buttonElement.dataset.originalText || '';

  // Aktiver knappen
  buttonElement.disabled = false;
}

/**
 * formatFileSize - Hjelpefunksjon for å formatere filstørrelse
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
 * displayChatMessages
 *  - Viser en hel liste av meldinger for en chat, urørt
 */
function displayChatMessages(messages) {
  clearChatMessages();
  messages.forEach(msg => {
    // Ingen fjerning av anførselstegn
    const content = msg.content;
    const html = renderMarkdown(content);
    appendMessageToChat(msg.role, html);
  });
}

/**
 * clearChatMessages - Fjerner alle meldinger fra chat-vinduet
 */
function clearChatMessages() {
  if (!chatMessages) {
    console.error("Chat messages element not found.");
    return;
  }
  chatMessages.innerHTML = '';
}

/**
 * createNewChat - Oppretter en ny chat via backend
 * @returns {string} - Den nye chat-ID-en
 */
async function createNewChat() {
  try {
    console.log("Oppretter ny chat med modell:", selectedModel);

    const response = await fetch(`${API_BASE_URL}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        title: "Ny_chat",  // Dette kan være midlertidig og blir renamet senere
        model: selectedModel 
      })
    });

    if (!response.ok) {
      console.error("Feil ved opprettelse av ny chat:", response.status, response.statusText);
      throw new Error("Feil ved opprettelse av ny chat.");
    }

    const chatData = await response.json();
    console.log("Backend returnerte chatData:", chatData);
    return chatData.title; // Bruk backend's genererte title (chat_id)
  } catch (error) {
    console.error("Feil ved opprettelse av ny chat:", error);
    throw error;
  }
}

/**
 * sendMessage - Hjelpefunksjon for å sende meldinger til backend
 * @param {string} chatId - ID til chatten
 * @param {string} message - Melding som skal sendes
 * @returns {object} - Respons fra backend
 */
async function sendMessage(chatId, message) {
  if (!chatId) {
    throw new Error('Chat ID er påkrevd');
  }

  const encodedChatId = encodeURIComponent(chatId);
  const url = `${API_BASE_URL}/chats/${encodedChatId}/messages`;
  
  console.log("Sending message to URL:", url); // Debug log
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message,
      model: selectedModel  // Bruk 'model' som backend forventer
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Nettverksfeil: ${response.status} ${response.statusText}\n${JSON.stringify(errorData)}`);
  }

  return await response.json();
}


async function onProcessLongContext() {
  // Hent melding og filer fra brukerinput
  const message = longContextInput.value.trim();
  const files = longContextFileInput.files;
  const preferredModel = preferredModelSelector.value;

  if (!message || files.length === 0) {
    alert("Vennligst skriv inn en melding og last opp minst én fil.");
    return;
  }

  const formData = new FormData();
  formData.append("message", message);
  for (const file of files) {
    formData.append("files", file);
  }
  if (preferredModel) {
    formData.append("preferred_model", preferredModel);
  }

  try {
    const response = await fetch(`${API_BASE_URL}/chat/long-context`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Backend returnerte data:", data);

    // Sjekk om chat_id er renamet
    if (data.new_chat_id) {
      console.log("Long-context Chat ID ble renamet til:", data.new_chat_id);
      // Oppdater currentChatId
      currentChatId = data.new_chat_id;
      console.log("Oppdatert currentChatId til:", currentChatId);

      // Oppdater chat-selector
      await fetchChats();
      if (chatSelector) {
        chatSelector.value = currentChatId;
        await loadChat(currentChatId);
      }
    } else {
      // Vis responsen
      appendMessageToChat('assistant', data.response);
    }

  } catch (error) {
    console.error('Feil ved behandling av long-context:', error);
    alert("Feil ved behandling av long-context.");
  }
}


/**
 * onSendMessage - Håndterer sending av meldinger
 */
async function onSendMessage() {
  if (!chatInput || !chatInput.value.trim()) return;

  const message = chatInput.value.trim();
  const fileInputs = document.querySelectorAll('.w-file-upload-input');
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
      formData.append('files', input.files[0]);
      hasFiles = true;
    }
  });

  // Vis brukerens melding, men fjern Context-delen hvis den finnes
  const cleanMessage = message.replace(/Context:[\s\S]*?(?=\n\s*Spørsmål:|$)/, '').trim();
  appendMessageToChat('user', cleanMessage);
  
  chatInput.value = '';
  appendMessageToChat('assistant', 'Genererer svar...');

  showSpinner(sendButton, 'Sender...');

  try {
    let data;

    if (hasFiles) {
      console.log("Sender request med filer til long-context endpoint");

      if (selectedModel) {
        formData.append('preferred_model', selectedModel);
      }

      const response = await fetch(`${API_BASE_URL}/chat/long-context`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Nettverksfeil: ${response.status} ${response.statusText}\n${JSON.stringify(errorData)}`);
      }

      data = await response.json();

      // Fjern "Genererer svar..." meldingen
      chatMessages.removeChild(chatMessages.lastChild);

      if (data.new_chat_id && data.new_chat_id !== currentChatId) {
        // Oppdater currentChatId men ikke last chat på nytt
        currentChatId = data.new_chat_id;
        console.log("Oppdatert currentChatId til:", currentChatId);
        
        // Oppdater chat-selector uten å laste chatten på nytt
        await fetchChats();
        if (chatSelector) {
          chatSelector.value = currentChatId;
        }
      }

      // Vis kun modellinfo og svar
      const modelInfo = `Modell: ${data.selected_model} | Kontekst: ${formatFileSize(data.context_length)} | Est. tokens: ${data.estimated_tokens}`;
      appendMessageToChat('system', modelInfo);
      appendMessageToChat('assistant', data.response);

    } else {
      // Vanlig chat uten filer
      if (!currentChatId) {
        currentChatId = await createNewChat();
        console.log("Oppdatert currentChatId til:", currentChatId);
      }

      if (!currentChatId) {
        throw new Error('Kunne ikke opprette ny chat');
      }

      data = await sendMessage(currentChatId, message);

      // Sjekk om chat_id er renamet
      if (data.new_chat_id) {
        console.log("Chat ID ble renamet til:", data.new_chat_id);
        // Oppdater currentChatId
        currentChatId = data.new_chat_id;
        console.log("Oppdatert currentChatId til:", currentChatId);

        // Oppdater chat-selector
        await fetchChats();
        if (chatSelector) {
          chatSelector.value = currentChatId;
          await loadChat(currentChatId);
        }
      } else {
        // Vis responsen
        appendMessageToChat('assistant', data.response);
      }

      chatInput.value = '';
    }

  } catch (error) {
    console.error('Feil ved sending av melding:', error);
    console.error('Full error object:', error);
    // Fjern den "Genererer svar..." meldingen
    const lastMessage = chatMessages.lastChild;
    if (lastMessage && lastMessage.textContent === 'Genererer svar...') {
      chatMessages.removeChild(lastMessage);
    }
    appendMessageToChat('error', `Det oppstod en feil ved sending av meldingen: ${error.message}`);
  } finally {
    // Spinner-funksjonalitet: Skjul spinner på sendButton uansett utfallet
    hideSpinner(sendButton);
  }
}

/**
 * onNewChat - Håndterer klikk på new-chat-button
 */
async function onNewChat() {
  try {
    console.log("Oppretter ny chat med modell:", selectedModel);

    // Spinner-funksjonalitet: Vis spinner på newChatButton
    showSpinner(newChatButton, 'Oppretter ny chat...');

    const chatId = await createNewChat();
    console.log("Backend returnerte chatId:", chatId);
    currentChatId = chatId; // Sett currentChatId til den unike ID-en
    console.log("Oppdatert currentChatId til:", currentChatId);

    await fetchChats();
    if (chatSelector) {
      chatSelector.value = currentChatId;
      await loadChat(currentChatId);
    }

    if (chatMessages) {
      chatMessages.innerHTML = '';
    }

    appendMessageToChat("assistant", renderMarkdown("Ny chat opprettet. Hvordan kan jeg hjelpe deg?"));
    console.log("Ny chat opprettet med ID:", currentChatId);
  } catch (error) {
    console.error("Feil ved opprettelse av ny chat:", error);
    alert("Feil ved opprettelse av ny chat.");
  } finally {
    // Spinner-funksjonalitet: Skjul spinner på newChatButton
    hideSpinner(newChatButton);
  }
}

/**
 * onUploadFiles - Filopplasting
 */
async function onUploadFiles() {
  console.log("Upload-knapp klikket");
  
  // Spinner-funksjonalitet: Vis spinner på uploadFilesButton
  showSpinner(uploadFilesButton, 'Laster opp filer...');
  
  // Hvis det ikke finnes en aktuell chat, opprett en ny chat
  if (!currentChatId) {
    try {
      currentChatId = await createNewChat();
      console.log("Ny chat opprettet med ID:", currentChatId);
    } catch (error) {
      console.error("Feil ved opprettelse av ny chat:", error);
      alert("Feil ved opprettelse av ny chat.");
      hideSpinner(uploadFilesButton); // Skjul spinner ved feil
      return;
    }
  }

  const fileInputs = document.querySelectorAll('.w-file-upload-input');
  if (!fileInputs || fileInputs.length === 0) {
    hideSpinner(uploadFilesButton); // Skjul spinner hvis ingen file inputs
    return;
  }

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
    hideSpinner(uploadFilesButton); // Skjul spinner hvis ingen filer
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
      throw new Error('Feil ved opplasting av filer.');
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
  } finally {
    // Spinner-funksjonalitet: Skjul spinner på uploadFilesButton uansett utfallet
    hideSpinner(uploadFilesButton);
  }
}

/**
 * onDeleteChat - Håndterer sletting av chat med bekreftelse
 */
function onDeleteChat() {
  if (!currentChatId) {
    alert("Vennligst velg en chat å slette.");
    return;
  }
  if (deleteConfirmation && overlay) {
    deleteConfirmation.style.display = 'block';
    overlay.style.display = 'block';
  }
}

/**
 * onConfirmDelete - Bekrefter sletting av chat
 */
async function onConfirmDelete() {
  // Spinner-funksjonalitet: Vis spinner på deleteConfirmYes-knappen
  showSpinner(deleteConfirmYes, 'Sletter...');

  try {
    const resp = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(currentChatId)}`, {
      method: 'DELETE'
    });
    if (!resp.ok) {
      console.error("Feil ved sletting av chat:", resp.status, resp.statusText);
      alert("Feil ved sletting av chat.");
      throw new Error('Feil ved sletting av chat.');
    }
    const data = await resp.json();
    alert(data.message);
    await fetchChats();
    clearChatMessages();
    currentChatId = null;
    selectedModel = null;
    if (modelSelector) {
      modelSelector.value = '';
    }
    if (deleteConfirmation && overlay) {
      deleteConfirmation.style.display = 'none';
      overlay.style.display = 'none';
    }
  } catch (error) {
    console.error("Feil ved sletting av chat:", error);
    alert("Feil ved sletting av chat.");
  } finally {
    // Spinner-funksjonalitet: Skjul spinner på deleteConfirmYes-knappen uansett utfallet
    hideSpinner(deleteConfirmYes);
  }
}

/**
 * onCancelDelete - Avbryter sletting av chat
 */
function onCancelDelete() {
  if (deleteConfirmation && overlay) {
    deleteConfirmation.style.display = 'none';
    overlay.style.display = 'none';
  }
}

/**
 * onModelChange - Håndterer endring av modell
 */
function onModelChange(e) {
  selectedModel = e.target.value;
  console.log('Valgt modell:', selectedModel);
}

/**
 * onChatChange - Håndterer endring av valgt chat
 */
async function onChatChange(e) {
  const chosen = e.target.value;
  if (chosen === "new") {
    await onNewChat();
  } else {
    await loadChat(chosen);
  }
}

/**
 * onSetUrl - Legg til URL-kontekst
 */
async function onSetUrl() {
  // Spinner-funksjonalitet: Vis spinner på setUrlButton
  showSpinner(setUrlButton, 'Henter...');

  if (!currentChatId) {
    try {
      currentChatId = await createNewChat();
      console.log("Ny chat opprettet med ID:", currentChatId);
    } catch (error) {
      console.error("Feil ved opprettelse av ny chat:", error);
      alert("Feil ved opprettelse av ny chat.");
      hideSpinner(setUrlButton); // Skjul spinner ved feil
      return;
    }
  }

  const url = urlInput.value.trim();
  const maxDepth = 1; // Juster etter behov
  if (!url) {
    alert("Vennligst skriv inn en URL.");
    hideSpinner(setUrlButton); // Skjul spinner hvis ingen URL
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
      throw new Error('Feil ved innstilling av URL.');
    }
    const data = await resp.json();
    alert(data.message);
    urlInput.value = '';
  } catch (error) {
    console.error("Feil ved innstilling av URL:", error);
    alert("Feil ved innstilling av URL.");
  } finally {
    // Spinner-funksjonalitet: Skjul spinner på setUrlButton uansett utfallet
    hideSpinner(setUrlButton);
  }
}

/**
 * fetchModels - Henter tilgjengelige modeller fra backend
 */
async function fetchModels() {
  try {
    console.log("Starter henting av modeller...");
    const response = await fetch(`${API_BASE_URL}/models`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const models = await response.json();
    console.log("Mottatte modeller:", models);
    
    // Sjekk at vi faktisk har modelSelector
    if (!modelSelector) {
      console.error("modelSelector er ikke definert. Prøver å finne element direkte.");
      const selector = document.getElementById('model-selector');
      if (!selector) {
        console.error("Fant ikke model-selector element i DOM");
        return;
      }
      // Hvis vi fant elementet, oppdater global variabel
      window.modelSelector = selector;
    }
    
    // Tøm eksisterende options
    modelSelector.innerHTML = '';
    
    // Legg til en tom option først
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Velg modell';
    modelSelector.appendChild(defaultOption);
    
    // Legg til hver modell som en option
    models.forEach(model => {
      console.log("Legger til modell:", model);
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelector.appendChild(option);
    });

    // Sett selectedModel hvis den ikke er satt
    if (!selectedModel && models.length > 0) {
      selectedModel = models[0];
      modelSelector.value = selectedModel;
      console.log("Satt standard modell til:", selectedModel);
    }
    
    console.log("Ferdig med å populere model-selector");
  } catch (error) {
    console.error('Feil ved henting av modeller:', error);
    console.error('Full error:', error.stack);
  }
}

/**
 * fetchChats - Henter tilgjengelige chats fra backend
 */
async function fetchChats() {
  try {
    const response = await fetch(`${API_BASE_URL}/chats`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const chats = await response.json();
    
    if (!chatSelector) {
      console.error("Chat selector not found");
      return;
    }
    
    // Tøm eksisterende options
    chatSelector.innerHTML = '';
    
    // Legg til "Ny chat" option
    const newChatOption = document.createElement('option');
    newChatOption.value = "new";
    newChatOption.textContent = "Ny chat";
    chatSelector.appendChild(newChatOption);
    
    // Legg til hver chat som en option
    chats.forEach(chat => {
      const option = document.createElement('option');
      option.value = chat; // Sett verdien til chat-tittelen (unik ID)
      option.textContent = chat; // Sett teksten til chat-tittelen
      chatSelector.appendChild(option);
    });

    console.log("Hentet chats:", chats);

    // Sett current chat hvis den finnes i listen
    if (currentChatId && chats.includes(currentChatId)) {
      chatSelector.value = currentChatId;
      await loadChat(currentChatId);
    } else {
      console.log("currentChatId finnes ikke i listen over chats.");
    }
  } catch (error) {
    console.error('Feil ved henting av chats:', error);
  }
}

/**
 * loadChat - Laster en spesifikk chat fra backend
 * @param {string} chatId - ID til chatten som skal lastes
 */
async function loadChat(chatId) {
  try {
    console.log("Laster chat med ID:", chatId);
    const response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chatId)}`);
    if (response.ok) {
      const chat = await response.json();
      currentChatId = chat.title; // 'chat.title' er den unike chat_id
      console.log("Oppdatert currentChatId til:", currentChatId);
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
 * handleFileSelection - Håndterer når en fil velges
 */
function handleFileSelection(event) {
  console.log("File selection triggered");
  
  const fileUploadDiv = event.target.closest('.w-file-upload');
  if (!fileUploadDiv) {
      console.log("File upload div not found");
      return;
  }

  const allFileUploads = document.querySelectorAll('.w-file-upload');
  console.log("Number of file uploads:", allFileUploads.length);

  // Count how many file uploads have a file selected
  const selectedFilesCount = Array.from(allFileUploads).filter(uploadDiv => {
      const successView = uploadDiv.querySelector('.w-file-upload-success');
      return successView && !successView.classList.contains('w-hidden');
  }).length;

  console.log("Number of selected files:", selectedFilesCount);

  if (selectedFilesCount >= 5) {
      console.log("Maximum number of file uploads reached");
      return;
  }

  // If a file is selected
  if (event.target.files && event.target.files[0]) {
      console.log("File selected:", event.target.files[0].name);

      // Update UI for the selected file
      const file = event.target.files[0];
      const defaultView = fileUploadDiv.querySelector('.w-file-upload-default');
      const successView = fileUploadDiv.querySelector('.w-file-upload-success');
      const fileNameDiv = fileUploadDiv.querySelector('.w-file-upload-file-name');

      if (defaultView && successView && fileNameDiv) {
          defaultView.classList.add('w-hidden');
          successView.classList.remove('w-hidden');
          fileNameDiv.textContent = file.name;
          console.log("UI updated for file:", file.name);
      }

      // Only add a new upload input if we have not reached the max
      if (selectedFilesCount < 5) {
          console.log("Creating a new upload element");
          const newUploadDiv = document.createElement('div');
          newUploadDiv.className = 'w-file-upload';
          const newId = `file-${allFileUploads.length + 1}`;
          newUploadDiv.innerHTML = `
            <div class="w-file-upload-default">
              <input class="w-file-upload-input" 
                     accept=".ai, .doc, .docx, .indd, .key, .numbers, .pps, .ppt, .pptx, .psd, .ods, .odt, .odp, .pages, .pdf, .txt, .xls, .xlsx, .csv, .pkl"
                     name="file"
                     data-name="File"
                     type="file"
                     id="${newId}"
                     style="height: 43.4766px; width: 1px;">
              <label for="${newId}"
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

          // Append the new upload div
          fileUploadDiv.parentNode.insertBefore(newUploadDiv, fileUploadDiv.nextSibling);

          // Add event listeners to the new input and remove button
          const newInput = newUploadDiv.querySelector('.w-file-upload-input');
          if (newInput) {
              console.log("Adding event listener to new input:", newInput.id);
              newInput.addEventListener('change', handleFileSelection);
          }

          const removeButton = newUploadDiv.querySelector('.w-file-remove-link');
          if (removeButton) {
              removeButton.addEventListener('click', function() {
                  console.log("Remove button clicked");
                  newUploadDiv.remove(); // Fjerner hele filopplastingsfeltet
              });
          }
      }
  }
}

/**
 * updateFileList - Viser en liste av opplastede filer
 */
function updateFileList(files) {
  if (!fileList) return;

  fileList.innerHTML = '';
  Array.from(files).forEach(file => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.textContent = `${file.name} (${formatFileSize(file.size)})`;
    fileList.appendChild(item);
  });
}

/**
 * setupEventListeners - Setter opp alle nødvendige event listeners
 */
function setupEventListeners() {
  console.log("Setting up event listeners...");
  
  if (modelSelector) {
    modelSelector.addEventListener('change', onModelChange);
  }
  if (chatSelector) {
    chatSelector.addEventListener('change', onChatChange);
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

  if (chatInput) {
    chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        onSendMessage();
      }
    });
  }

  console.log("Event listeners setup complete");
}

/**
 * updateChatSelector - Oppdaterer chat-selector med ny chat-id
 * @param {string} newChatId - Den nye chat-id-en som skal settes
 */
async function updateChatSelector(newChatId) {
  await fetchChats();
  if (chatSelector) {
    chatSelector.value = newChatId;
    await loadChat(newChatId);
  }
}

/**
 * Initialiser når DOM er lastet
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOMContentLoaded triggered");
  
  fetchModels();
  fetchChats();
  setupEventListeners();

  if (chatInput) {
      chatInput.style.color = "#000";
  }

  // Legg til event listener på eksisterende filopplastingsfelt
  const initialFileInputs = document.querySelectorAll('.w-file-upload-input');
  initialFileInputs.forEach(input => {
    input.addEventListener('change', handleFileSelection);
  });
});
