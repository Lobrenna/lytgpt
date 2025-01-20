// URL til FastAPI-backenden (lokal utvikling)
const API_BASE_URL = "http://localhost:8000";

console.log("API endpoints configuration:", {
  messagesEndpoint: `${API_BASE_URL}/chats/[chatId]/messages`,
  baseUrl: API_BASE_URL
});

// Elementer fra Webflow (juster ID-ene om nødvendig)
const modelSelector = document.getElementById('model-selector');
const chatSelector = document.getElementById('chat-selector');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const uploadFilesInput = document.querySelector('.w-file-upload-input');
const uploadFilesButton = document.getElementById('upload-files-button');
const urlInput = document.getElementById('url-input');
const setUrlButton = document.getElementById('set-url-button');
const newChatButton = document.getElementById('new-chat-button');
const deleteChatButton = document.getElementById('delete-chat-button');
const deleteConfirmation = document.getElementById('delete-confirmation');
const deleteConfirmYes = document.getElementById('delete-confirm-yes');
const deleteConfirmNo = document.getElementById('delete-confirm-no');
const overlay = document.getElementById('overlay');
const longContextInput = document.getElementById('long-context-input');
const longContextButton = document.getElementById('long-context-button');
const fileList = document.getElementById('file-list'); // For å vise opplastede filer

// State
let currentChatId = null;
let selectedModel = null;

/**
 * Konfigurer marked.js for å integrere med Prism.js
 */
marked.setOptions({
  renderer: new marked.Renderer(),
  gfm: true,
  breaks: true,
  headerIds: false,
  langPrefix: 'language-', // Viktig for Prism
  highlight: function (code, lang) {
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
      if (modelSelector) {
        modelSelector.value = selectedModel;
      }
      await fetchChats();
      if (chatSelector) {
        chatSelector.value = currentChatId;
        await loadChat(currentChatId);
      }
      appendMessageToChat("assistant", renderMarkdown("Ny chat opprettet. Hvordan kan jeg hjelpe deg?"));
      console.log("Ny chat opprettet med ID:", currentChatId);
      return currentChatId;
    } else {
      console.error("Feil ved opprettelse av ny chat:", response.status, response.statusText);
      throw new Error("Feil ved opprettelse av ny chat.");
    }
  } catch (error) {
    console.error("Feil ved opprettelse av ny chat:", error);
    currentChatId = null;
    throw error;
  }
}

/**
 * sendMessage - Hjelpefunksjon for å sende meldinger til backend
 */
async function sendMessage(chatId, message, retryCount = 3) {
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
      preferred_model: selectedModel
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Nettverksfeil: ${response.status} ${response.statusText}\n${JSON.stringify(errorData)}`);
  }

  return await response.json();
}

/**
 * onSendMessage - Håndterer sending av meldinger
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
    
    // Sjekk om filen er valgt (success view er synlig)
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
        await createNewChat();
      }
      
      if (!currentChatId) {
        throw new Error('Kunne ikke opprette ny chat');
      }

      const encodedChatId = encodeURIComponent(currentChatId);
      response = await fetch(`${API_BASE_URL}/chats/${encodedChatId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message,
          preferred_model: selectedModel
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
    chatMessages.removeChild(chatMessages.lastChild);
    appendMessageToChat('error', `Det oppstod en feil ved sending av meldingen: ${error.message}`);
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
 * createNewChatId - Genererer en ny URL-vennlig chat ID
 * @returns {string} Den genererte chat ID-en
 */
function createNewChatId() {
  const now = new Date();
  return `Chat_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
}

/**
 * onNewChat - Håndterer klikk på new-chat-button
 */
async function onNewChat() {
  try {
    const chatId = createNewChatId();
    
    const response = await fetch(`${API_BASE_URL}/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: chatId,
        model: selectedModel || "gpt-4o"
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const chatData = await response.json();
    currentChatId = chatId;

    await fetchChats();
    if (chatSelector) {
      chatSelector.value = currentChatId;
    }

    if (chatMessages) {
      chatMessages.innerHTML = '';
    }

    console.log("Ny chat opprettet med ID:", currentChatId);
  } catch (error) {
    console.error("Feil ved opprettelse av ny chat:", error);
    alert("Feil ved opprettelse av ny chat.");
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
    const chatId = createNewChatId();
    await createNewChat();
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
    const chatId = createNewChatId();
    await createNewChat();
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
 * onDeleteChat
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
      overlay.style.display = 'none';
    }
  } catch (error) {
    console.error("Feil ved sletting av chat:", error);
    alert("Feil ved sletting av chat.");
  }
}

function onCancelDelete() {
  if (deleteConfirmation && overlay) {
    deleteConfirmation.style.display = 'none';
    overlay.style.display = 'none';
  }
}

/**
 * setupEventListeners
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

  if (longContextButton) {
    longContextButton.addEventListener('click', handleLongContextSubmit);
  }

  console.log("Event listeners setup complete");
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

// Vis valgte filer
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
    console.log("Starting cleanupFileUploads");
    
    // Fjern eksisterende event listeners før vi legger til nye
    const existingInputs = document.querySelectorAll('.w-file-upload-input');
    existingInputs.forEach(input => {
        input.removeEventListener('change', handleFileSelection);
        console.log("Removed event listener from:", input.id);
    });
    
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
        console.log("Adding event listener to new input:", newInput.id);
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
 * onModelChange - Håndterer endring av modell
 */
function onModelChange(e) {
  selectedModel = e.target.value;
  console.log('Valgt modell:', selectedModel);
}

/**
 * fetchChats - Henter eksisterende chats fra backend
 */
/**
 * fetchChats - Henter eksisterende chats fra backend
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
      option.value = chat; // Sett verdien til chat-tittelen
      option.textContent = chat; // Sett teksten til chat-tittelen
      chatSelector.appendChild(option);
    });
    
    // Sett current chat hvis den finnes i listen
    if (currentChatId) {
      chatSelector.value = currentChatId;
    }
  } catch (error) {
    console.error('Feil ved henting av chats:', error);
  }
}


/**
 * loadChat - Laster en eksisterende chat
 */
/**
 * loadChat - Laster en eksisterende chat
 */
async function loadChat(chatId) {
  try {
    const response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chatId)}`);
    if (response.ok) {
      const chat = await response.json();
      currentChatId = chat.title; // 'chat.title' skal være den unike chat_id
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



// Initialiser når DOM er lastet
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOMContentLoaded triggered");
  console.log("Upload files input:", uploadFilesInput);
  console.log("Upload files button:", uploadFilesButton);
  
  fetchModels();
  fetchChats();
  setupEventListeners();

  if (chatInput) {
      chatInput.style.color = "#000";
  }

  // Legg til event listener på eksisterende filopplastingsfelt
  if (uploadFilesInput) {
      uploadFilesInput.addEventListener('change', handleFileSelection);
  }
});

