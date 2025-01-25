// Umiddelbar logging når scriptet lastes
console.log('%c🚀 LYT GPT Frontend v8.0.5 Loading...', 'font-size: 20px; font-weight: bold; color: #4CAF50;');

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

// NB: Hent tak i long-selector
const longSelector = document.getElementById('long-selector');

// State
let currentChatId = null;
let selectedModel = null;
let isScraping = false; // Ny tilstand for å forhindre multiple scraping

// Konfigurer marked.js for å integrere med Prism.js
const renderer = new marked.Renderer();

// Tilpass renderer for å unngå overflødige p-tagger
renderer.listitem = function(text) {
  if (text.startsWith('<p>') && text.endsWith('</p>')) {
    text = text.slice(3, -4);
  }
  return `<li>${text}</li>`;
};

renderer.paragraph = function(text) {
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
  langPrefix: 'language-',
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
 */
function renderMarkdown(markdownText) {
  if (typeof markdownText !== 'string') {
    console.warn('Invalid markdown input:', markdownText);
    return '';
  }
  
  let html = marked.parse(markdownText);
  html = html.replace(/\n\s*\n/g, '\n');
  html = html.replace(/<p>(\s*<[uo]l>)/g, '$1');
  html = html.replace(/(<\/[uo]l>\s*)<\/p>/g, '$1');
  return html;
}

/**
 * showSpinner / hideSpinner
 */
function showSpinner(buttonElement, message) {
  if (!buttonElement) return;
  if (isScraping) {
    console.warn('Scraping already in progress.');
    return;
  }
  isScraping = true;
  buttonElement.dataset.originalText = buttonElement.innerHTML;
  buttonElement.innerHTML = `<span class="spinner"></span>${message}`;
  buttonElement.disabled = true;
}
function hideSpinner(buttonElement) {
  if (!buttonElement) return;
  buttonElement.innerHTML = buttonElement.dataset.originalText || '';
  buttonElement.disabled = false;
  isScraping = false;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
async function populateLongSelector() {
  const longSelector = document.getElementById("long-selector");
  if (!longSelector) return;

  try {
    const response = await fetch(`${API_BASE_URL}/long-context-options`);
    if (!response.ok) {
      throw new Error(`Feil: HTTP ${response.status}`);
    }
    const options = await response.json();
    
    longSelector.innerHTML = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "-- Ingen valgt --";
    longSelector.appendChild(emptyOption);

    for (const key in options) {
      if (options.hasOwnProperty(key)) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = key;
        longSelector.appendChild(option);
      }
    }
  } catch (error) {
    console.error("Feil ved henting av long-context alternativer:", error);
  }
}

function appendMessageToChat(role, htmlContent) {
  if (!chatMessages) {
    console.error("Chat messages element not found.");
    return;
  }
  const msgEl = document.createElement('div');
  msgEl.classList.add('chat-message', role);
  msgEl.style.whiteSpace = 'pre-wrap';

  if (role === 'user') {
    if (typeof htmlContent === 'string' && htmlContent.includes('Context:')) {
      const questionMatch = htmlContent.match(/Spørsmål:([^]*?)$/);
      if (questionMatch) {
        htmlContent = questionMatch[1].trim();
      }
    }
    htmlContent = htmlContent.replace(/<p>(.*?)<\/p>/g, '$1');
  }

  if (role === 'user' && !htmlContent.includes('</code>') && !htmlContent.includes('\n```')) {
    htmlContent = renderMarkdown(htmlContent);
  }

  msgEl.innerHTML = htmlContent;

  const codeBlocks = msgEl.querySelectorAll('pre code');
  codeBlocks.forEach((block) => {
    Prism.highlightElement(block);
  });

  chatMessages.appendChild(msgEl);
  chatMessages.scrollTo({
    top: chatMessages.scrollHeight,
    behavior: 'smooth'
  });
  
  return msgEl;
}

function displayChatMessages(messages) {
  clearChatMessages();
  messages.forEach(msg => {
    const content = msg.content;
    const html = renderMarkdown(content);
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
 * Konstanter som matcher backend
 */
const MODEL_TOKEN_LIMITS = {
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gemini-pro": 128000,
    "gemini-1.5-pro": 2097152,
    "claude-3-5-sonnet-20240620": 80000,
    "claude-3-opus-20240229": 80000,
    "claude-3-sonnet-20240229": 80000,
    "claude-3-haiku-20240307": 80000
};

/**
 * createNewChat - Oppdatert for å håndtere nye modeller
 */
async function createNewChat() {
    try {
        const response = await fetch(`${API_BASE_URL}/chats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: selectedModel })
        });
        
        if (!response.ok) {
            console.error("createNewChat: Feil respons:", response.status, response.statusText);
            throw new Error('Feil ved opprettelse av chat');
        }
        const data = await response.json();
        if (data.title) {
            return data.title;
        } else if (data.chat_id) {
            return data.chat_id;
        } else {
            console.error("createNewChat: Mangler chat_id i responsen:", data);
            throw new Error('Mangler chat_id i respons fra server');
        }
    } catch (error) {
        console.error('createNewChat: Feil:', error);
        throw error;
    }
}

async function onNewChat() {
    try {
        currentChatId = await createNewChat();
        await updateChatSelector(currentChatId);
        clearChatMessages();
    } catch (error) {
        console.error("onNewChat: Feil:", error);
        alert("Feil ved opprettelse av ny chat.");
    }
}

async function sendMessage(chatId, message) {
    if (!chatId) {
        throw new Error('Chat ID er påkrevd');
    }

    const encodedChatId = encodeURIComponent(chatId);
    const url = `${API_BASE_URL}/chats/${encodedChatId}/messages`;
    console.log("Sender melding til:", url);

    const formData = new FormData();
    formData.append('message', message);
    formData.append('model', selectedModel);

    const longSelector = document.getElementById('long-selector');
    if (longSelector) {
        const selectedLongContext = longSelector.value;
        if (selectedLongContext) {
            console.log("Valgt long context:", selectedLongContext);
            formData.append('long_context_selection', selectedLongContext);
        }
    }

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

    backendFiles.forEach(backendFile => {
        formData.append('backend_files', backendFile);
    });

    manualFiles.forEach(file => {
        formData.append('files', file);
    });

    try {
        console.log("Sender forespørsel til:", url);
        const response = await fetch(url, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(
                `Nettverksfeil: ${response.status} ${response.statusText}\n` +
                JSON.stringify(errorData)
            );
        }

        const data = await response.json();
        console.log("Server respons:", data);
        return data;
    } catch (error) {
        console.error("Feil ved sending av melding:", error);
        throw error;
    }
}

async function onSendMessage() {
    if (!chatInput || !chatInput.value.trim()) return;
    
    try {
        const message = chatInput.value.trim();
        chatInput.value = '';
        
        if (!currentChatId) {
            currentChatId = await createNewChat();
        }
        
        // Add temporary "Generating..." message
        const generatingMessage = appendMessageToChat('assistant', 'Genererer svar...');
        showSpinner(sendButton, 'Sender...');
        
        const data = await sendMessage(currentChatId, message);
        console.log("Mottatt data fra server:", data);
        
        // Remove temporary message
        if (generatingMessage && generatingMessage.parentNode) {
            generatingMessage.parentNode.removeChild(generatingMessage);
        }
        
        // Show model info if available
        if (data.selected_model && data.context_length !== undefined && data.estimated_tokens !== undefined) {
            const modelInfo = `Modell: ${data.selected_model} | Kontekst (antall tokens): ${data.context_length} | Est. tokens: ${data.estimated_tokens}`;
            appendMessageToChat('system', modelInfo);
        }
        
        appendMessageToChat('assistant', renderMarkdown(data.response));
        
        // Update chat ID if needed
        if (data.new_chat_id) {
            currentChatId = data.new_chat_id;
            await updateChatSelector(currentChatId);
        }
        
    } catch (error) {
        console.error('Feil ved sending av melding:', error);
        appendMessageToChat('error', `Det oppstod en feil ved sending av meldingen: ${error.message}`);
    } finally {
        hideSpinner(sendButton);
    }
}

function initializeModelSelector() {
  if (modelSelector && modelSelector.options.length > 0) {
    const firstModel = modelSelector.options[0].value;
    modelSelector.value = firstModel;
    selectedModel = firstModel;
    console.log("Initialisert med første tilgjengelige modell:", firstModel);
  }
}

/**
 * onUploadFiles
 */
async function onUploadFiles() {
  showSpinner(uploadFilesButton, 'Laster opp filer...');
  
  if (!currentChatId) {
    try {
      currentChatId = await createNewChat();
    } catch (error) {
      console.error("Feil ved opprettelse av ny chat:", error);
      alert("Feil ved opprettelse av ny chat.");
      hideSpinner(uploadFilesButton);
      return;
    }
  }

  const fileInputs = document.querySelectorAll('.w-file-upload-input');
  if (!fileInputs || fileInputs.length === 0) {
    hideSpinner(uploadFilesButton);
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
    hideSpinner(uploadFilesButton);
    return;
  }

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
    alert(data.message);

    // Tøm alle file inputs
    fileInputs.forEach(input => {
      input.value = '';
      input.removeAttribute('data-backend-file');
    });
  } catch (error) {
    console.error("Feil ved opplasting av filer:", error);
    alert("Feil ved opplasting av filer.");
  } finally {
    hideSpinner(uploadFilesButton);
  }
}

/**
 * deleteChat
 */
async function deleteChat(chatId) {
  try {
    const response = await fetch(`${API_BASE_URL}/chats`);
    const chats = await response.json();
    const nextChat = chats.find(chat => {
      const chatTitle = typeof chat === 'string' ? chat : chat.title;
      return chatTitle !== chatId;
    });

    const deleteResponse = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chatId)}`, {
      method: 'DELETE'
    });
    if (!deleteResponse.ok) {
      throw new Error('Feil ved sletting av chat');
    }

    if (nextChat) {
      currentChatId = typeof nextChat === 'string' ? nextChat : nextChat.title;
    } else {
      currentChatId = await createNewChat();
    }
    
    await fetchChats();
    if (chatSelector) {
      chatSelector.value = currentChatId;
      await loadChat(currentChatId);
    }
  } catch (error) {
    console.error("deleteChat: Feil:", error);
    alert("Feil ved sletting av chat.");
  }
}

async function onDeleteChat() {
  if (!currentChatId) return;
  try {
    showSpinner(deleteChatButton, 'Sletter...');
    await deleteChat(currentChatId);
  } catch (error) {
    console.error("onDeleteChat: Feil:", error);
    alert("Feil ved sletting av chat.");
  } finally {
    hideSpinner(deleteChatButton);
  }
}

function onModelChange(e) {
  selectedModel = e.target.value;
  console.log('Valgt modell:', selectedModel);
}

async function onChatChange(e) {
  const chosen = e.target.value;
  if (chosen === "new") {
    await onNewChat();
  } else {
    await loadChat(chosen);
  }
}

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

  const fileUploadDiv = Array.from(allFileUploads).find(uploadDiv => {
    const successView = uploadDiv.querySelector('.w-file-upload-success');
    return successView && successView.classList.contains('w-hidden');
  });

  if (fileUploadDiv) {
    const uploadSuccess = fileUploadDiv.querySelector('.w-file-upload-success');
    const uploadDefault = fileUploadDiv.querySelector('.w-file-upload-default');
    const fileNameDiv = uploadSuccess.querySelector('.w-file-upload-file-name');

    if (uploadSuccess && uploadDefault && fileNameDiv) {
      fileNameDiv.textContent = filename;
      uploadSuccess.classList.remove('w-hidden');
      uploadDefault.classList.add('w-hidden');

      const fileInput = fileUploadDiv.querySelector('.w-file-upload-input');
      if (fileInput) {
        fileInput.setAttribute('data-backend-file', filename);
      }
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

function removeFileUpload(fileUploadDiv, isBackend = false) {
  if (!fileUploadDiv) return;
  if (isBackend) {
    const fileInput = fileUploadDiv.querySelector('.w-file-upload-input');
    if (fileInput) {
      fileInput.removeAttribute('data-backend-file');
    }
  } else {
    const fileInput = fileUploadDiv.querySelector('.w-file-upload-input');
    if (fileInput) {
      fileInput.value = '';
    }
  }

  const uploadSuccess = fileUploadDiv.querySelector('.w-file-upload-success');
  const uploadDefault = fileUploadDiv.querySelector('.w-file-upload-default');
  const fileNameDiv = uploadSuccess.querySelector('.w-file-upload-file-name');
  if (uploadSuccess && uploadDefault && fileNameDiv) {
    fileNameDiv.textContent = '';
    uploadSuccess.classList.add('w-hidden');
    uploadDefault.classList.remove('w-hidden');
  }

  // Fjern div hvis det er en ekstra opplastingsdiv
  const allFileUploads = document.querySelectorAll('.w-file-upload');
  if (allFileUploads.length > 1) {
    fileUploadDiv.remove();
  }
}

/**
 * onSetUrl - Oppdatert for å håndtere URL-scraping
 */
async function onSetUrl() {
    if (!urlInput || !urlInput.value.trim()) {
        alert('Vennligst skriv inn en URL');
        return;
    }

    const url = urlInput.value.trim();
    showSpinner(setUrlButton, 'Scraper...');

    try {
        if (!currentChatId) {
            currentChatId = await createNewChat();
        }

        const response = await fetch(`${API_BASE_URL}/chats/${currentChatId}/context/url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        appendMessageToChat('system', `URL scrapet: ${url}`);
        urlInput.value = '';

    } catch (error) {
        console.error('Feil ved scraping av URL:', error);
        appendMessageToChat('error', `Feil ved scraping av URL: ${error.message}`);
    } finally {
        hideSpinner(setUrlButton);
    }
}

/**
 * fetchModels
 */
async function fetchModels() {
  try {
    const response = await fetch(`${API_BASE_URL}/models`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const models = await response.json();
    if (!modelSelector) {
      console.error("modelSelector er ikke definert");
      return;
    }
    modelSelector.innerHTML = '';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelector.appendChild(option);
    });
    if (models.length > 0) {
      selectedModel = models[0];
      modelSelector.value = selectedModel;
    }
  } catch (error) {
    console.error('Feil ved henting av modeller:', error);
  }
}

let isInitialized = false;

/**
 * DOMContentLoaded
 */
document.addEventListener('DOMContentLoaded', async () => {
    if (isInitialized) return;
    
    try {
        console.log("Starter initialisering...");
        
        // 1) Hent modeller og initialiser model selector
        await fetchModels();
        initializeModelSelector();
        console.log("Modeller hentet og initialisert");

        // 2) Hent long-context valg
        await populateLongSelector();
        console.log("Long-context valg hentet");

        // 3) Hent oversikt over chats
        await fetchChats();
        console.log("Chats hentet");

        // 4) Sett opp event listeners
        setupEventListeners();
        console.log("Event listeners satt opp");

        // 5) Opprett ny chat om vi ikke har en
        if (!currentChatId) {
            try {
                currentChatId = await createNewChat();
                console.log("Ny chat opprettet:", currentChatId);
            } catch (error) {
                console.error("Feil ved opprettelse av ny chat:", error);
            }
        }

        if (chatInput) {
            chatInput.style.color = "#000";
        }

        const initialFileInputs = document.querySelectorAll('.w-file-upload-input');
        initialFileInputs.forEach(input => {
            input.addEventListener('change', handleFileSelection);
        });
        
        isInitialized = true;
        console.log("Initialisering fullført");
    } catch (error) {
        console.error("Feil under initialisering:", error);
    }
});

/**
 * fetchChats - Oppdatert for å håndtere alle chat-data
 */
async function fetchChats(autoLoad = true) {
    try {
        const response = await fetch(`${API_BASE_URL}/chats`);
        if (!response.ok) throw new Error('Feil ved henting av chats');
        
        const chats = await response.json();
        if (chatSelector) {
            chatSelector.innerHTML = '';
            chats.forEach(chat => {
                const option = document.createElement('option');
                option.value = chat.id;
                option.textContent = chat.title || chat.id;
                chatSelector.appendChild(option);
            });
            
            // Velg den første chatten hvis ingen er valgt
            if (chats.length > 0 && !currentChatId) {
                currentChatId = chats[0].id;
                chatSelector.value = currentChatId;
                loadChat(currentChatId);
            }
        }
    } catch (error) {
        console.error('Feil ved henting av chats:', error);
    }
}

/**
 * loadChat - Oppdatert for å håndtere alle chatdata
 */
async function loadChat(chatId) {
    if (!chatId) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/chats/${chatId}`);
        if (!response.ok) throw new Error('Feil ved lasting av chat');
        
        const chatData = await response.json();
        
        // Oppdater modell-selector hvis tilgjengelig
        if (modelSelector && chatData.model) {
            modelSelector.value = chatData.model;
            selectedModel = chatData.model;
        }
        
        // Vis meldinger
        displayChatMessages(chatData.messages);
        
        // Håndter filer hvis de finnes
        if (chatData.files) {
            chatData.files.forEach(file => {
                addBackendFileUpload(file);
            });
        }
        
        // Håndter long context selection hvis det finnes
        if (chatData.long_context_selection && longSelector) {
            longSelector.value = chatData.long_context_selection;
        }
        
        // Oppdater UI med kontekstlengde og token-estimater
        updateUIElements(chatData);
        
    } catch (error) {
        console.error('Feil ved lasting av chat:', error);
        appendMessageToChat('error', `Feil ved lasting av chat: ${error.message}`);
    }
}

/**
 * updateUIElements - Forbedret versjon
 */
function updateUIElements(data) {
    if (!data) return;
    
    try {
        // Oppdater modell-info
        if (data.selected_model) {
            const modelInfo = document.getElementById('model-info');
            if (modelInfo) {
                modelInfo.textContent = `Modell: ${data.selected_model}`;
            }
        }
        
        // Oppdater kontekstlengde
        if (data.context_length !== undefined) {
            const contextLength = document.getElementById('context-length');
            if (contextLength) {
                contextLength.textContent = `Kontekst: ${data.context_length} tokens`;
            }
        }
        
        // Oppdater token-estimat
        if (data.estimated_tokens !== undefined) {
            const tokenEstimate = document.getElementById('token-estimate');
            if (tokenEstimate) {
                tokenEstimate.textContent = `Est. tokens: ${data.estimated_tokens}`;
            }
        }
        
        // Oppdater fil-liste hvis tilgjengelig
        if (data.files && fileList) {
            fileList.innerHTML = '';
            data.files.forEach(file => {
                const item = document.createElement('div');
                item.className = 'file-item';
                item.textContent = file;
                fileList.appendChild(item);
            });
        }
    } catch (error) {
        console.error('Feil ved oppdatering av UI-elementer:', error);
    }
}

/**
 * Hjelpefunksjon for å sjekke om en modell støtter RAG
 */
function isRagSupportedModel(model) {
    // Liste over modeller som støtter RAG
    const ragSupportedModels = [
        "gpt-4o",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "gemini-1.5-pro"
    ];
    return ragSupportedModels.includes(model);
}

// Oppdater setupEventListeners
function setupEventListeners() {
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
    if (urlInput) {
        urlInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                onSetUrl();
            }
        });
    }
    const urlForm = document.getElementById('email-form');
    if (urlForm) {
        urlForm.addEventListener('submit', (event) => {
            event.preventDefault();
            event.stopPropagation();
            return false;
        });
    }

    // Initialiser file inputs
    const initialFileInputs = document.querySelectorAll('.w-file-upload-input');
    initialFileInputs.forEach(input => {
        input.addEventListener('change', handleFileSelection);
    });
}

/**
 * updateChatSelector
 */
async function updateChatSelector(newChatId) {
  await fetchChats();
  if (chatSelector) {
    chatSelector.value = newChatId;
    await loadChat(newChatId);
  }
}

// Sikrer at removeFileUpload er tilgjengelig globalt
window.removeFileUpload = removeFileUpload;

function handleFileSelection(event) {
    const fileUploadDiv = event.target.closest('.w-file-upload');
    if (!fileUploadDiv) return;

    const allFileUploads = document.querySelectorAll('.w-file-upload');
    const selectedFilesCount = Array.from(allFileUploads).filter(uploadDiv => {
        const successView = uploadDiv.querySelector('.w-file-upload-success');
        return successView && !successView.classList.contains('w-hidden');
    }).length;

    if (selectedFilesCount >= 5) return;

    if (event.target.files && event.target.files[0]) {
        const file = event.target.files[0];
        const defaultView = fileUploadDiv.querySelector('.w-file-upload-default');
        const uploadSuccess = fileUploadDiv.querySelector('.w-file-upload-success');
        const fileNameDiv = fileUploadDiv.querySelector('.w-file-upload-file-name');

        if (defaultView && uploadSuccess && fileNameDiv) {
            fileNameDiv.textContent = file.name;
            uploadSuccess.classList.remove('w-hidden');
            defaultView.classList.add('w-hidden');
        }

        // Add remove button functionality
        const removeButton = uploadSuccess.querySelector('.w-file-remove-link');
        if (removeButton) {
            removeButton.addEventListener('click', function () {
                removeFileUpload(fileUploadDiv);
            });
        }

        // Create new upload div if needed
        if (selectedFilesCount < 5) {
            // ... existing file upload div creation code ...
        }
    }
}
