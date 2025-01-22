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
  msgEl.style.whiteSpace = 'pre-wrap';

  // For brukerens meldinger, fjern context-delen hvis den finnes
  if (role === 'user') {
    // Sjekk om innholdet starter med "Context:"
    if (typeof htmlContent === 'string' && htmlContent.includes('Context:')) {
      // Finn spørsmålet (alt etter "Spørsmål:")
      const questionMatch = htmlContent.match(/Spørsmål:([^]*?)$/);
      if (questionMatch) {
        htmlContent = questionMatch[1].trim();
      }
    }
    
    // Fjern <p> tags fra brukerens meldinger
    htmlContent = htmlContent.replace(/<p>(.*?)<\/p>/g, '$1');
  }

  // Sjekk om innholdet ser ut som ren kode (ingen markdown)
  if (role === 'user' && !htmlContent.includes('</code>') && !htmlContent.includes('\n```')) {
    // Konverter til markdown
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
 * createNewChat - Oppretter en ny chat på backend
 */
async function createNewChat() {
  try {
    console.log("createNewChat: Starter med modell:", selectedModel);
    const response = await fetch(`${API_BASE_URL}/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: selectedModel })
    });
    
    if (!response.ok) {
      console.error("createNewChat: Feil respons fra server:", response.status, response.statusText);
      throw new Error('Feil ved opprettelse av chat');
    }
    const data = await response.json();
    console.log("createNewChat: Mottatt data fra server:", data);
    
    // Sjekk strukturen på data-objektet
    if (data.title) {
      console.log("createNewChat: Bruker data.title som chat_id:", data.title);
      return data.title;
    } else if (data.chat_id) {
      console.log("createNewChat: Bruker data.chat_id:", data.chat_id);
      return data.chat_id;
    } else {
      console.error("createNewChat: Kunne ikke finne chat_id i responsen:", data);
      throw new Error('Mangler chat_id i respons fra server');
    }
  } catch (error) {
    console.error('createNewChat: Feil:', error);
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

  console.log("Sending message to URL:", url);

  const formData = new FormData();
  formData.append('message', message);
  formData.append('model', selectedModel);

  // Hent backend-filer fra data-attributter
  const fileInputs = document.querySelectorAll('.w-file-upload-input');
  const backendFiles = [];
  const manualFiles = [];

  fileInputs.forEach(input => {
    const backendFile = input.getAttribute('data-backend-file');
    if (backendFile) {
      backendFiles.push(backendFile);
    }
    if (input.files && input.files[0]) {
      manualFiles.push(input.files[0]);
    }
  });

  // Logg backendFiles og manualFiles
  console.log("Backend files to send:", backendFiles);
  console.log("Manual files to send:", manualFiles);

  // Append 'backend_files' som separate oppføringer
  backendFiles.forEach(backendFile => {
    formData.append('backend_files', backendFile);
  });

  // Append 'files' som separate oppføringer
  manualFiles.forEach(file => {
    formData.append('files', file);
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Nettverksfeil: ${response.status} ${response.statusText}\n${JSON.stringify(errorData)}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Feil ved sending av melding:", error);
    throw error;
  }
}


/**
 * onSendMessage - Håndterer sending av meldinger
 */
async function onSendMessage() {
  if (!chatInput || !chatInput.value.trim()) return;

  const message = chatInput.value.trim();

  // 1. Vis brukerens melding først
  appendMessageToChat('user', renderMarkdown(message));
  chatInput.value = '';

  // Fjern eventuell tidligere generering av svar
  const generatingMessage = appendMessageToChat('assistant', 'Genererer svar...');
  showSpinner(sendButton, 'Sender...');

  try {
    let data;

    console.log("Sender melding til backend med både manuelle og backend-filer.");

    // Send melding med begge typer filer
    data = await sendMessage(currentChatId, message);
    console.log("Mottatt data fra server:", data);

    // Fjern "Genererer svar..." meldingen
    if (generatingMessage && generatingMessage.parentNode) {
      generatingMessage.parentNode.removeChild(generatingMessage);
    }

    // Log detaljer om responsen
    console.log("Selected Model:", data.selected_model);
    console.log("Context Length:", data.context_length);
    console.log("Estimated Tokens:", data.estimated_tokens);
    console.log("Response:", data.response);
    console.log("New Chat ID:", data.new_chat_id);

    // Vis modellinfo hvis tilgjengelig
    if (data.selected_model && data.context_length !== undefined && data.estimated_tokens !== undefined) {
      const modelInfo = `Modell: ${data.selected_model} | Kontekst: ${formatFileSize(data.context_length)} | Est. tokens: ${data.estimated_tokens}`;
      appendMessageToChat('system', modelInfo);
    } else {
      console.warn("Manglende felter i respons fra server:", data);
    }

    // Formater og vis svaret med markdown
    appendMessageToChat('assistant', renderMarkdown(data.response));

    // Hvis en ny chat-id er returnert, oppdater den
    if (data.new_chat_id) {
      currentChatId = data.new_chat_id;
      console.log("Oppdatert currentChatId til:", currentChatId);
      await updateChatSelector(currentChatId);
    }

  } catch (error) {
    console.error('Feil ved sending av melding:', error);
    if (generatingMessage && generatingMessage.parentNode) {
      generatingMessage.parentNode.removeChild(generatingMessage);
    }
    appendMessageToChat('error', `Det oppstod en feil ved sending av meldingen: ${error.message}`);
  } finally {
    hideSpinner(sendButton);
  }
}


/**
 * onNewChat - Håndterer klikk på new-chat-button
 */
async function onNewChat() {
  try {
    console.log("Oppretter ny chat med modell:", selectedModel);
    showSpinner(newChatButton, 'Oppretter ny chat...');

    const chatId = await createNewChat();
    console.log("Backend returnerte chatId:", chatId);
    currentChatId = chatId;
    console.log("Oppdatert currentChatId til:", currentChatId);

    // Oppdater chat-selector og last inn den nye chatten
    await fetchChats();
    if (chatSelector) {
      chatSelector.value = currentChatId;
      await loadChat(currentChatId);
    }

    // Tøm meldingsvinduet
    if (chatMessages) {
      chatMessages.innerHTML = '';
    }

    // Nullstill file upload
    const fileUploadDefault = document.querySelector('.w-file-upload-default');
    if (fileUploadDefault) {
      fileUploadDefault.style.display = 'block';
    }

    const fileUploadSuccess = document.querySelector('.w-file-upload-success');
    if (fileUploadSuccess) {
      fileUploadSuccess.style.display = 'none';
    }

    const fileInput = document.querySelector('.w-file-upload-input');
    if (fileInput) {
      fileInput.value = '';
      fileInput.removeAttribute('data-backend-file'); // Fjern eventuelle backend-filreferanser
    }

    // Fjern den ekstra file upload widgeten hvis den eksisterer
    const extraFileUpload = document.querySelector('.w-file-upload:nth-child(2)');
    if (extraFileUpload) {
      extraFileUpload.remove();
    }

    // Nullstill URL input
    if (urlInput) {
      urlInput.value = '';
    }

    // Legg til velkomstmelding
    appendMessageToChat("assistant", renderMarkdown("Ny chat opprettet. Hvordan kan jeg hjelpe deg?"));
    console.log("Ny chat opprettet med ID:", currentChatId);
  } catch (error) {
    console.error("Feil ved opprettelse av ny chat:", error);
    alert("Feil ved opprettelse av ny chat.");
  } finally {
    hideSpinner(newChatButton);
  }
}

// Legg til denne funksjonen for å sette standard modell ved oppstart
function initializeModelSelector() {
  if (modelSelector && modelSelector.options.length > 0) {
    const firstModel = modelSelector.options[0].value;
    modelSelector.value = firstModel;
    selectedModel = firstModel;
    console.log("Initialisert med første tilgjengelige modell:", firstModel);
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
      input.removeAttribute('data-backend-file'); // Fjern eventuelle backend-filreferanser
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
 * deleteChat - Sletter en spesifikk chat
 * @param {string} chatId - ID til chatten som skal slettes
 */
async function deleteChat(chatId) {
  try {
    console.log("deleteChat: Starter sletting av chat:", chatId);
    
    // Hent alle chats før sletting for å finne nest nyeste
    const response = await fetch(`${API_BASE_URL}/chats`);
    const chats = await response.json();
    console.log("deleteChat: Hentet eksisterende chats:", chats);
    
    // Finn nest nyeste chat (hvis den finnes)
    const nextChat = chats.find(chat => {
      const chatTitle = typeof chat === 'string' ? chat : chat.title;
      return chatTitle !== chatId;
    });
    console.log("deleteChat: Neste chat å bytte til:", nextChat);

    // Slett nåværende chat
    const deleteResponse = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chatId)}`, {
      method: 'DELETE'
    });
    
    if (!deleteResponse.ok) {
      console.error("deleteChat: Feil ved sletting:", deleteResponse.status, deleteResponse.statusText);
      throw new Error('Feil ved sletting av chat');
    }

    console.log("deleteChat: Chat slettet:", chatId);
    
    // Hvis vi har en nest nyeste chat, bruk den. Ellers opprett ny
    if (nextChat) {
      currentChatId = typeof nextChat === 'string' ? nextChat : nextChat.title;
      console.log("deleteChat: Bytter til eksisterende chat:", currentChatId);
    } else {
      currentChatId = await createNewChat();
      console.log("deleteChat: Ingen eksisterende chat funnet, opprettet ny:", currentChatId);
    }
    
    // Oppdater chat-selector og last inn den valgte chatten
    await fetchChats();
    if (chatSelector) {
      chatSelector.value = currentChatId;
      await loadChat(currentChatId);
    }

    // Tøm meldingsvinduet hvis vi opprettet ny chat
    if (!nextChat && chatMessages) {
      chatMessages.innerHTML = '';
    }
  } catch (error) {
    console.error("deleteChat: Feil:", error);
    alert("Feil ved sletting av chat.");
  }
}

/**
 * onDeleteChat - Håndterer klikk på delete-chat-button
 */
async function onDeleteChat() {
  console.log("onDeleteChat: Starter sletting");
  if (!currentChatId) {
    console.log("onDeleteChat: Ingen aktiv chat å slette");
    return;
  }

  try {
    showSpinner(deleteChatButton);
    await deleteChat(currentChatId);
  } catch (error) {
    console.error("onDeleteChat: Feil:", error);
    alert("Feil ved sletting av chat.");
  } finally {
    hideSpinner(deleteChatButton);
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

// URL input og scraping
if (urlInput && setUrlButton) {
  urlInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSetUrl();
    }
  });

  setUrlButton.addEventListener('click', (event) => {
    event.preventDefault();
    onSetUrl();
  });
}

// Hjelpefunksjon for å vise feilmeldinger
function showError(message) {
  const errorElement = document.querySelector('.w-form-fail');
  if (errorElement) {
    errorElement.style.display = 'block';
    errorElement.querySelector('div').textContent = message;
    setTimeout(() => {
      errorElement.style.display = 'none';
    }, 3000);
  }
}

/**
 * addBackendFileUpload - Legger til en filopplastingskomponent fra backend
 * @param {string} filename - Navnet på filen fra backend
 */
function addBackendFileUpload(filename) {
  const allFileUploads = document.querySelectorAll('.w-file-upload');
  const selectedFilesCount = Array.from(allFileUploads).filter(uploadDiv => {
    const successView = uploadDiv.querySelector('.w-file-upload-success');
    return successView && !successView.classList.contains('w-hidden');
  }).length;

  if (selectedFilesCount >= 5) {
    alert("Maks antall opplastede filer nådd.");
    return;
  }

  // Finn den første ledige filopplastingsdiven
  const fileUploadDiv = Array.from(allFileUploads).find(uploadDiv => {
    const successView = uploadDiv.querySelector('.w-file-upload-success');
    return successView && successView.classList.contains('w-hidden');
  });

  if (fileUploadDiv) {
    // Sett filnavn og vis success state
    const uploadSuccess = fileUploadDiv.querySelector('.w-file-upload-success');
    const uploadDefault = fileUploadDiv.querySelector('.w-file-upload-default');
    const fileNameDiv = uploadSuccess.querySelector('.w-file-upload-file-name');

    if (uploadSuccess && uploadDefault && fileNameDiv) {
      fileNameDiv.textContent = filename;
      uploadSuccess.classList.remove('w-hidden');
      uploadDefault.classList.add('w-hidden');

      // Lagre backend-referansen i et data-attributt
      const fileInput = fileUploadDiv.querySelector('.w-file-upload-input');
      if (fileInput) {
        fileInput.setAttribute('data-backend-file', filename);
      }

      // Legg til fjerning av backend-fil
      const removeButton = uploadSuccess.querySelector('.w-file-remove-link');
      if (removeButton) {
        removeButton.addEventListener('click', function () {
          removeFileUpload(fileUploadDiv, true);
        });
      }
    }
  } else {
    console.warn("Ingen ledige filopplastingsdiver funnet.");
  }
}

/**
 * removeFileUpload - Fjerner en filopplastingskomponent
 * @param {HTMLElement} fileUploadDiv - Filopplastingsdiven som skal fjernes
 * @param {boolean} isBackend - Indikerer om filen er fra backend
 */
function removeFileUpload(fileUploadDiv, isBackend = false) {
  if (!fileUploadDiv) return;

  if (isBackend) {
    // Fjern backend-referanse
    const fileInput = fileUploadDiv.querySelector('.w-file-upload-input');
    if (fileInput) {
      fileInput.removeAttribute('data-backend-file');
    }
  } else {
    // Fjern faktisk fil fra input
    const fileInput = fileUploadDiv.querySelector('.w-file-upload-input');
    if (fileInput) {
      fileInput.value = '';
    }
  }

  // Oppdater UI
  const uploadSuccess = fileUploadDiv.querySelector('.w-file-upload-success');
  const uploadDefault = fileUploadDiv.querySelector('.w-file-upload-default');
  const fileNameDiv = uploadSuccess.querySelector('.w-file-upload-file-name');

  if (uploadSuccess && uploadDefault && fileNameDiv) {
    fileNameDiv.textContent = '';
    uploadSuccess.classList.add('w-hidden');
    uploadDefault.classList.remove('w-hidden');
  }
}

/**
 * onSetUrl - Håndterer scraping av URL og mottak av backend-fil
 */
async function onSetUrl() {
  showSpinner(setUrlButton, 'Henter...');

  if (!currentChatId) {
    try {
      currentChatId = await createNewChat();
      console.log("Ny chat opprettet med ID:", currentChatId);
    } catch (error) {
      console.error("Feil ved opprettelse av ny chat:", error);
      alert("Feil ved opprettelse av ny chat.");
      hideSpinner(setUrlButton);
      return;
    }
  }

  const url = urlInput.value.trim();
  if (!url) {
    alert("Vennligst skriv inn en URL.");
    hideSpinner(setUrlButton);
    return;
  }

  try {
    const resp = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(currentChatId)}/context/url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: url })
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data = await resp.json();
    console.log("URL scrapet og fil lastet:", data.context_file);

    // Oppdater file upload UI med backend-fil
    addBackendFileUpload(data.context_file);

    urlInput.value = '';
  } catch (error) {
    console.error("Feil ved innstilling av URL:", error);
    alert("Feil ved innstilling av URL.");
  } finally {
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
    
    if (!modelSelector) {
      console.error("modelSelector er ikke definert");
      return;
    }
    
    // Tøm eksisterende options
    modelSelector.innerHTML = '';
    
    // Legg til hver modell som en option
    models.forEach(model => {
      console.log("Legger til modell:", model);
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelector.appendChild(option);
    });

    // Sett første modell som aktiv hvis det finnes modeller
    if (models.length > 0) {
      selectedModel = models[0];
      modelSelector.value = selectedModel;
      console.log("Satt standard modell til:", selectedModel);
    }
    
    console.log("Ferdig med å populere model-selector");
  } catch (error) {
    console.error('Feil ved henting av modeller:', error);
  }
}

// Legg til en global variabel for å spore om vi har initialisert
let isInitialized = false;

/**
 * Initialiser når DOM er lastet
 */
document.addEventListener('DOMContentLoaded', async () => {
  console.log("DOMContentLoaded: Starter initialisering");
  if (isInitialized) {
    console.log("DOMContentLoaded: Allerede initialisert, hopper over");
    return;
  }
  
  // Vent på at modeller lastes først
  console.log("DOMContentLoaded: Laster modeller");
  await fetchModels();
  console.log("DOMContentLoaded: Modeller lastet, selectedModel:", selectedModel);

  // Opprett en ny chat hvis ingen er aktiv
  if (!currentChatId) {
    try {
      console.log("DOMContentLoaded: Ingen aktiv chat, oppretter ny");
      currentChatId = await createNewChat();
      console.log("DOMContentLoaded: Ny chat opprettet:", currentChatId);
    } catch (error) {
      console.error("DOMContentLoaded: Feil ved opprettelse av ny chat:", error);
    }
  }

  // Deretter last chats og sett opp event listeners
  console.log("DOMContentLoaded: Laster chats");
  await fetchChats();
  console.log("DOMContentLoaded: Setter opp event listeners");
  setupEventListeners();

  if (chatInput) {
    chatInput.style.color = "#000";
  }

  // Legg til event listener på eksisterende filopplastingsfelt
  const initialFileInputs = document.querySelectorAll('.w-file-upload-input');
  initialFileInputs.forEach(input => {
    input.addEventListener('change', handleFileSelection);
  });

  isInitialized = true;
  console.log("DOMContentLoaded: Initialisering fullført");
});

/**
 * fetchChats - Henter tilgjengelige chats fra backend
 */
async function fetchChats(autoLoad = true) {
  try {
    console.log("fetchChats: Starter henting av chats");
    const response = await fetch(`${API_BASE_URL}/chats`);
    if (!response.ok) throw new Error('Feil ved henting av chats');
    const chats = await response.json();
    console.log("fetchChats: Mottatt chats fra server:", chats);

    if (chatSelector) {
      console.log("fetchChats: Oppdaterer chat selector");
      chatSelector.innerHTML = '';
      chats.forEach(chat => {
        const chatTitle = typeof chat === 'string' ? chat : chat.title;
        //console.log("fetchChats: Legger til chat:", chatTitle);
        const option = document.createElement('option');
        option.value = chatTitle;
        option.textContent = chatTitle;
        chatSelector.appendChild(option);
      });

      // Hvis currentChatId ikke finnes i listen, reset det
      const chatExists = chats.some(chat => {
        const chatTitle = typeof chat === 'string' ? chat : chat.title;
        return chatTitle === currentChatId;
      });
      console.log("fetchChats: Sjekker currentChatId:", currentChatId, "Eksisterer:", chatExists);
      
      if (currentChatId && chatExists) {
        console.log("fetchChats: Setter aktivt valg til currentChatId:", currentChatId);
        chatSelector.value = currentChatId;
        if (autoLoad) {
          await loadChat(currentChatId);
        }
      } else {
        console.log("fetchChats: Ingen gyldig currentChatId funnet");
      }
    } else {
      console.error("fetchChats: chatSelector ikke funnet i DOM");
    }
  } catch (error) {
    console.error('fetchChats: Feil:', error);
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

      // Sjekk om chat har context_files og oppdater UI
      if (chat.context_files && Array.isArray(chat.context_files)) {
        chat.context_files.forEach(filename => {
          addBackendFileUpload(filename);
        });
      }

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
      const uploadSuccess = fileUploadDiv.querySelector('.w-file-upload-success');
      const fileNameDiv = fileUploadDiv.querySelector('.w-file-upload-file-name');

      if (defaultView && uploadSuccess && fileNameDiv) {
          fileNameDiv.textContent = file.name;
          uploadSuccess.classList.remove('w-hidden');
          defaultView.classList.add('w-hidden');
          console.log("UI updated for file:", file.name);
      }

      // Legg til fjerning av fil
      const removeButton = uploadSuccess.querySelector('.w-file-remove-link');
      if (removeButton) {
        removeButton.addEventListener('click', function () {
          removeFileUpload(fileUploadDiv);
        });
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
                <div aria-label="Remove file" role="button" tabindex="0" class="w-file-remove-link">
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
  
          const newRemoveButton = newUploadDiv.querySelector('.w-file-remove-link');
          if (newRemoveButton) {
            newRemoveButton.addEventListener('click', function () {
              removeFileUpload(newUploadDiv);
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
    console.log("Setter opp event listener for delete-chat-button");
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

  // Handle URL input enter key
  if (urlInput) {
    urlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        onSetUrl();
      }
    });
  }

  // Prevent form submission
  const urlForm = document.getElementById('email-form');
  if (urlForm) {
    urlForm.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopPropagation();
      return false;
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

// Sikre at removeFileUpload er tilgjengelig globalt
window.removeFileUpload = removeFileUpload;

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
