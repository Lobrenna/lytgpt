console.log('JavaScript fil lastet!');

// URL til FastAPI-backenden (oppdater hvis nødvendig)
const API_BASE_URL = "http://localhost:8000";

// Elementer fra DOM
const modelSelector = document.getElementById('model-selector');
const chatSelector = document.getElementById('chat-selector');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const deepbButton = document.getElementById('button-deepb');
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

// Kopling mellom chat-navn og chat-ID
let titleToChatIdMap = {}; // Global mapping: title -> chatId

// State
let currentChatId = null;
let selectedModel = null;
let isScraping = false; // Ny tilstand for å forhindre multiple scraping

// For å lagre globalt type long-context vi velger
let longContextExtensions = {};

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
function renderMarkdown(content) {
  // Sjekk om input er ugyldig
  if (!content) {
      console.warn('Invalid input:', content);
      return '';
  }
  // Sjekk om innholdet er en DeepB-tabell (ser etter karakteristiske mønstre)
  if (typeof content === 'string' && content.includes('| Domene | Likhet | Beskrivelse |')) {
      // Parse tabelldata fra markdown-format
      const rows = content.split('\n').filter(row => row.trim());
      const tableData = rows.slice(2) // Hopp over header og separator
          .map(row => {
              const [domain, score, description] = row.split('|').slice(1, -1).map(cell => cell.trim());
              return { domain, score, description };
          });
      // Generer HTML-tabell med vår tilpassede styling
      const tableRows = tableData.map(row => `
          <tr>
              <td><a href="https://${row.domain}" target="_blank">${row.domain}</a></td>
              <td>${row.score}</td>
              <td>${row.description}</td>
          </tr>`).join('\n');
      return `
      <div class="table-container">
          <table class="deepb-results-table">
              <thead>
                  <tr>
                      <th>Domene</th>
                      <th>Likhet</th>
                      <th>Beskrivelse</th>
                  </tr>
              </thead>
              <tbody>
                  ${tableRows}
              </tbody>
          </table>
      </div>`;
  }
  // For vanlig markdown-tekst
  let html = marked.parse(content);
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
    // Henter hele ordboka (alle tilgjengelige modeller) ved å kalle endepunktet uten query-parameter
    const response = await fetch(`${API_BASE_URL}/long-context-options`);
    if (!response.ok) {
      throw new Error(`Feil: HTTP ${response.status}`);
    }

    const options = await response.json();
    console.log("populateLongSelector: Alternativer hentet:", options);

    // Tøm <select>-elementet før vi legger til nye valg
    longSelector.innerHTML = "";

    // Legg til et tomt valg først
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "-- Ingen valgt --";
    longSelector.appendChild(emptyOption);

    // Gå gjennom ordboka: nøkkel = "Claude docs", verdi = ["long/claude_docs.txt"]
    for (const key in options) {
      if (options.hasOwnProperty(key)) {
        const option = document.createElement("option");
        option.value = key;         // "Claude docs"
        option.textContent = key;   // vises i UI
        longSelector.appendChild(option);

        // Bestem filendelsen
        let fileExtension = "";
        if (Array.isArray(options[key]) && options[key].length > 0) {
          const firstFilePath = options[key][0];
          const lastDotIndex = firstFilePath.lastIndexOf('.');
          if (lastDotIndex !== -1) {
            fileExtension = firstFilePath.substring(lastDotIndex);
          }
        } else if (typeof options[key] === 'string') {
          // Hvis backend av en eller annen grunn returnerer en streng
          const lastDotIndex = options[key].lastIndexOf('.');
          if (lastDotIndex !== -1) {
            fileExtension = options[key].substring(lastDotIndex);
          }
        }

        // Lagre filendelsen i global variabel
        longContextExtensions[key] = fileExtension;
      }
    }
    console.log("populateLongSelector: Long context extensions lagret:", longContextExtensions);
  } catch (error) {
    console.error("Feil ved henting av long-context alternativer:", error);
  }
}

/**
 * appendMessageToChat
 */
function appendMessageToChat(role, content) {
  if (!chatMessages) {
      console.error("Chat messages element not found.");
      return;
  }
  const msgEl = document.createElement('div');
  msgEl.classList.add('chat-message', role);
  // For brukerens meldinger, fjern ev. "Context:" etc.
  if (role === 'user') {
      if (typeof content === 'string' && content.includes('Context:')) {
          const questionMatch = content.match(/Spørsmål:([^]*?)$/);
          if (questionMatch) {
              content = questionMatch[1].trim();
          }
      }
      content = content.replace(/<p>(.*?)<\/p>/g, '$1');
  }
  // Sjekk om innholdet er en tabell (DeepB-resultater)
  if (content.includes('<table class="deepb-results-table"')) {
      msgEl.innerHTML = content;
  } else {
      // Vanlig markdown-formatering for andre meldinger
      if (role === 'user' && !content.includes('</code>') && !content.includes('\n```')) {
          content = renderMarkdown(content);
      }
      msgEl.innerHTML = content;
  }
  // Syntax-highlighting for kodeblokker
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
 */
function displayChatMessages(messages) {
  if (!chatMessages) return;
  chatMessages.innerHTML = '';
  messages.forEach(message => {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${message.role}`;
    
    // Håndter forskjellige meldingstyper
    if (message.role === 'sources') {
      // For kildehenvisninger, bruk pre-formatert tekst
      messageDiv.innerHTML = `<pre>${message.content}</pre>`;
    } else {
      // For vanlige meldinger, bruk markdown-rendering
      messageDiv.innerHTML = renderMarkdown(message.content);
    }
    
    chatMessages.appendChild(messageDiv);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearChatMessages() {
  if (!chatMessages) {
    console.error("Chat messages element not found.");
    return;
  }
  chatMessages.innerHTML = '';
}

/**
 * createNewChat
 */
async function createNewChat() {
  if (!selectedModel) {
    console.error("createNewChat: selectedModel er ikke definert.");
    alert("Ingen modell valgt. Vennligst velg en modell før du oppretter en ny chat.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel })
    });

    if (!response.ok) {
      let errorMsg = `createNewChat: Feil respons: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMsg += ` - ${JSON.stringify(errorData)}`;
      } catch (e) {
        // Responsen inneholder ikke JSON
      }
      console.error(errorMsg);
      throw new Error('Feil ved opprettelse av chat');
    }

    const data = await response.json();
    console.log("createNewChat: Mottatt data fra backend:", data); // For debugging

    const chatId = data.id || data.title; // Bruk title som fallback
    const chatTitle = data.title || chatId; // Sikre at chatTitle alltid er definert

    if (!chatId) {
      console.error("createNewChat: `id` og `title` er ikke definert i backend-responsen.");
      throw new Error('Backend returnerte ingen `id` eller `title` for den nye chatten.');
    }

    // Oppdater mappingen
    titleToChatIdMap[chatTitle] = chatId;
    console.log("createNewChat: titleToChatIdMap oppdatert:", titleToChatIdMap);

    // Oppdater dropdown
    const option = document.createElement('option');
    option.value = chatTitle; // Bruk title som verdi i dropdown
    option.textContent = chatTitle; // Vis title i dropdown
    chatSelector.appendChild(option);

    // Sett valgt chat til den nye chatten
    chatSelector.value = chatTitle;
    currentChatId = chatId; // Sett currentChatId til den nye chatten
    console.log("createNewChat: currentChatId satt til:", currentChatId);
    await loadChat(chatId); // Last inn den nye chatten

    console.log("createNewChat: Ny chat opprettet med ID:", chatId);

    return chatId;
  } catch (error) {
    console.error('createNewChat: Feil:', error);
    alert(`Feil ved opprettelse av chat: ${error.message}`);
    throw error;
  }
}

/**
 * sendMessage
 */
async function sendMessage(chatId, message) {
  if (!chatId) {
    throw new Error('Chat ID er påkrevd');
  }

  console.log("sendMessage: Starter med chatId:", chatId);

  // Klargjør endepunkt-URL
  const encodedChatId = encodeURIComponent(chatId);

  let url = `${API_BASE_URL}/chats/${encodedChatId}/messages`; // Default URL

  // Hent valgt long-context
  const longSelector = document.getElementById('long-selector');
  let selectedLongContext = null;
  let fileExtension = null;

  if (longSelector && longSelector.value) {
    selectedLongContext = longSelector.value;
    console.log("sendMessage: Valgt long context:", selectedLongContext);

    // Slå opp filendelsen fra den globale variabelen
    fileExtension = longContextExtensions[selectedLongContext];
    console.log("sendMessage: Filendelse for valgt context:", fileExtension);

    if (fileExtension === ".pkl") {
      // Hvis vi får .pkl, send til /rag
      console.log("Filendelse er .pkl. Sender til /rag");
      url = `${API_BASE_URL}/chats/${encodedChatId}/rag`;
    } else {
      // For alle andre filendelser, send til /messages
      console.log(`Filendelse er ${fileExtension}. Sender til /messages`);
      url = `${API_BASE_URL}/chats/${encodedChatId}/messages`;
    }
  }

  // Opprett FormData
  const formData = new FormData();
  formData.append('message', message);
  formData.append('model', selectedModel);

  // Append long_context_selection hvis valgt
  if (selectedLongContext) {
    formData.append("long_context_selection", selectedLongContext);
  }

  // Håndter filopplastinger
  const fileInputs = document.querySelectorAll('.w-file-upload-input');
  let hasFiles = false;

  fileInputs.forEach((input, index) => {
    // Sjekk for backend-filer
    const backendFile = input.getAttribute('data-backend-file');
    if (backendFile) {
      formData.append('backend_files', backendFile);
      hasFiles = true;
      console.log(`Adding backend file: ${backendFile}`);
    }
    // Sjekk for lokale filer
    if (input.files && input.files[0]) {
      formData.append('files', input.files[0]);
      hasFiles = true;
      console.log(`Adding local file: ${input.files[0].name}`);
    }
  });

  console.log("sendMessage: FormData contents:");
  for (let pair of formData.entries()) {
    console.log(pair[0], pair[1]);
  }

  try {
    console.log("sendMessage: Sender forespørsel til:", url);
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      let errorMsg = `sendMessage: Feil respons: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMsg += ` - ${JSON.stringify(errorData)}`;
      } catch (e) {
        // Responsen inneholder ikke JSON
      }
      console.error(errorMsg);
      throw new Error(
        `Nettverksfeil: ${response.status} ${response.statusText}`
      );
    }

    const responseData = await response.json();
    console.log("sendMessage: Mottatt svar fra server:", responseData);
    return responseData;
  } catch (error) {
    console.error("sendMessage: Feil ved sending av melding:", error);
    throw error;
  }
}

// Separate function for updating UI elements
function updateUIElements(data) {
  if (!data) return;
  
  try {
    if (data.selected_model && typeof updateModelInfo === 'function') {
      updateModelInfo(data.selected_model);
    }
    if (data.context_length && typeof updateContextLength === 'function') {
      updateContextLength(data.context_length);
    }
    if (data.estimated_tokens && typeof updateEstimatedTokens === 'function') {
      updateEstimatedTokens(data.estimated_tokens);
    }
  } catch (error) {
    console.error('Error updating UI elements:', error);
  }
}

/**
 * onSendMessage
 */
async function onSendMessage() {
  if (!chatInput || !chatInput.value.trim()) return;

  const message = chatInput.value.trim();

  // 1. Vis brukerens melding i chatvinduet
  appendMessageToChat('user', renderMarkdown(message));
  chatInput.value = '';

  // Midlertidig melding
  const generatingMessage = appendMessageToChat('assistant', 'Genererer svar...');
  showSpinner(sendButton, 'Sender...');

  try {
    if (!currentChatId) {
      throw new Error('Ingen aktiv chat');
    }

    let data;
    console.log("Sender melding til backend...");

    data = await sendMessage(currentChatId, message);
    console.log("Mottatt data fra server:", data);

    // Fjern "Genererer svar..."
    if (generatingMessage && generatingMessage.parentNode) {
      generatingMessage.parentNode.removeChild(generatingMessage);
    }

    // Vis litt info
    if (data.selected_model && data.context_length !== undefined && data.estimated_tokens !== undefined) {
      const modelInfo = `Modell: ${data.selected_model} | Kontekst (antall tokens): ${data.context_length} | Est. tokens: ${data.estimated_tokens}`;
      appendMessageToChat('system', modelInfo);
    }

    appendMessageToChat('assistant', renderMarkdown(data.response));

    // **Oppdater `titleToChatIdMap` hvis tittelen har endret seg**
    // Anta at backend returnerer den oppdaterte tittelen etter renaming
    if (data.title && data.title !== getCurrentChatTitle()) {
      const oldTitle = getCurrentChatTitle();
      const newTitle = data.title;

      // Oppdater mappingen
      delete titleToChatIdMap[oldTitle];
      titleToChatIdMap[newTitle] = currentChatId;

      // Oppdater chat-selektoren
      updateChatSelectorOption(oldTitle, newTitle);

      console.log(`Chat ${currentChatId} omdøpt til: ${newTitle}`);
    }

    // Log for debugging
    console.log("Current Chat ID etter sendMessage:", currentChatId);
    console.log("Title to Chat ID Map etter sendMessage:", titleToChatIdMap);

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

// Ny funksjon for å håndtere DeepB-søk
async function handleDeepBSearch() {
  if (!currentChatId) {
      console.error("Ingen aktiv chat funnet");
      alert("Vennligst start en ny chat først");
      return;
  }
  const button = document.getElementById('button_deepb');
  const chatInput = document.getElementById('chat-input');
  // Lagre original button state
  const originalButtonText = button.textContent;
  try {
      // Vis loading state
      showSpinner(button, 'Søker...');
      // Opprett FormData
      const formData = new FormData();
      // Legg til company_brief hvis det finnes tekst i chat-input
      if (chatInput && chatInput.value.trim()) {
          formData.append('company_brief', chatInput.value.trim());
      }
      // Legg til num_results (valgfritt)
      formData.append('num_results', '20');
      // Utfør API-kall
      const response = await fetch(`${API_BASE_URL}/chats/${currentChatId}/deepb_search`, {
          method: 'POST',
          body: formData
      });
      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      // Håndter respons
      if (data.response) {
          // Tøm input-feltet hvis det ble brukt
          if (chatInput) {
              chatInput.value = '';
          }
          // Vis søkeresultatene i chat
          appendMessageToChat('assistant', renderMarkdown(data.response));
          // Oppdater UI elementer hvis nødvendig
          updateUIElements(data);
      }
  } catch (error) {
      console.error('Feil ved DeepB-søk:', error);
      appendMessageToChat('error', `Det oppstod en feil ved søket: ${error.message}`);
  } finally {
      // Gjenopprett original button state
      hideSpinner(button);
      button.textContent = originalButtonText;
  }
}

/**
 * getCurrentChatTitle
 * Hjelpefunksjon for å hente den nåværende chat-tittelen
 */
function getCurrentChatTitle() {
  if (!chatSelector) return null;
  return chatSelector.value;
}

/**
 * updateChatSelectorOption
 * Hjelpefunksjon for å oppdatere en eksisterende option i chat-selektoren
 */
function updateChatSelectorOption(oldTitle, newTitle) {
  if (!chatSelector) return;
  const options = chatSelector.options;
  for (let i = 0; i < options.length; i++) {
    if (options[i].value === oldTitle) {
      options[i].value = newTitle;
      options[i].textContent = newTitle;
      break;
    }
  }
}

/**
 * onNewChat
 */
async function onNewChat() {
  try {
    showSpinner(newChatButton, 'Oppretter ny chat...');
    const chatId = await createNewChat();
    currentChatId = chatId;

    if (chatMessages) {
      chatMessages.innerHTML = '';
    }
    appendMessageToChat("assistant", renderMarkdown("Ny chat opprettet. Hvordan kan jeg hjelpe deg?"));
  } catch (error) {
    console.error("Feil ved opprettelse av ny chat:", error);
    alert("Feil ved opprettelse av ny chat.");
  } finally {
    hideSpinner(newChatButton);
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
    // Backend-filer håndteres via 'data-backend-file' attributt
    const backendFile = input.getAttribute('data-backend-file');
    if (backendFile) {
      formData.append(`backend_file${index + 1}`, backendFile);
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

    // Oppdater fillisten hvis du har en visuell liste
    updateFileList([]);

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
    const deleteResponse = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chatId)}`, {
      method: 'DELETE'
    });
    if (!deleteResponse.ok) {
      throw new Error('Feil ved sletting av chat');
    }

    // Fjern fra mappingen
    const chatTitle = Object.keys(titleToChatIdMap).find(title => titleToChatIdMap[title] === chatId);
    if (chatTitle) {
      delete titleToChatIdMap[chatTitle];
    }

    // Oppdater dropdown og velg en annen chat
    await fetchChats(false);

    // Hvis det finnes en ny valgt chat, last den
    if (currentChatId) {
      await loadChat(currentChatId);
    } else {
      // Opprett en ny chat hvis ingen eksisterer
      currentChatId = await createNewChat();
      appendMessageToChat("assistant", "Ny chat opprettet. Hvordan kan jeg hjelpe deg?");
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

/**
 * onChatChange
 */
async function onChatChange(e) {
  const chosenTitle = e.target.value;
  const chatId = titleToChatIdMap[chosenTitle] || chosenTitle; // Bruk title som fallback

  if (!chatId) {
    console.warn("Fant ikke chatId for valgt title:", chosenTitle);
    try {
      // Dette bør ikke skje hvis mappingen er korrekt
      currentChatId = await createNewChat();
      chatSelector.value = Object.keys(titleToChatIdMap).find(
        title => titleToChatIdMap[title] === currentChatId
      ) || currentChatId; // Sikre at verdien ikke er undefined
      appendMessageToChat("assistant", "Ny chat opprettet. Hvordan kan jeg hjelpe deg?");
    } catch (error) {
      console.error("Feil ved opprettelse av ny chat:", error);
    }
  } else {
    await loadChat(chatId); // Bruk riktig chatId for backend-kall
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
}

/**
 * onSetUrl
 */
async function onSetUrl() {
  if (isScraping) {
    console.warn('Scraping already in progress.');
    return;
  }
  showSpinner(setUrlButton, 'Scraper...');
  if (!currentChatId) {
    try {
      currentChatId = await createNewChat();
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    });

    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }

    const data = await resp.json();
    addBackendFileUpload(data.context_file);
    urlInput.value = '';
  } catch (error) {
    console.error("Feil ved innstilling av URL:", error);
    alert("Feil ved innstilling av URL.");
  } finally {
    hideSpinner(setUrlButton);
  }
}

async function fetchModels() {
  try {
    const response = await fetch(`${API_BASE_URL}/models`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const models = await response.json();
    console.log('Hentede modeller:', models); // Logg modellene som hentes

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
      console.log('Standardmodell satt til:', selectedModel);
    } else {
      console.error('Ingen modeller tilgjengelig.');
    }
  } catch (error) {
    console.error('Feil ved henting av modeller:', error);
  }
}

let isInitialized = false;

/**
 * fetchChats
 * @param {boolean} autoLoad - Om funksjonen skal automatisk laste inn den valgte chatten
 * @returns {Array} - Returnerer listen av chatter
 */
async function fetchChats() {
  try {
    const response = await fetch(`${API_BASE_URL}/chats`);
    if (!response.ok) {
      throw new Error(`fetchChats: Feil respons: ${response.status} ${response.statusText}`);
    }

    const chats = await response.json();
    console.log("fetchChats: Hentede chatter:", chats);

    const chatSelector = document.getElementById("chat-selector");
    if (!chatSelector) {
      console.error("fetchChats: chatSelector ikke funnet.");
      return;
    }

    // Tøm <select>-elementet før vi legger til nye valg
    chatSelector.innerHTML = "";

    // Legg til et tomt valg først
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "-- Velg en chat --";
    chatSelector.appendChild(emptyOption);

    // Legg til hver chat som en option i dropdown
    chats.forEach(chat => {
      const option = document.createElement("option");
      option.value = chat.id || chat.title; // Bruk ID hvis tilgjengelig, ellers title
      option.textContent = chat.title || chat.id; // Vis title i UI
      chatSelector.appendChild(option);
    });

    console.log("fetchChats: chatSelector oppdatert.");
  } catch (error) {
    console.error("fetchChats: Feil ved henting av chatter:", error);
  }
}


/**
 * loadChat
 */
async function loadChat(chatId) {
  if (!chatId) {
    console.error("loadChat: chatId er undefined eller null.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chatId)}`);
    if (response.ok) {
      const chat = await response.json();
      currentChatId = chatId;

      // Oppdater tittel og vis meldinger
      const chatTitleEl = document.getElementById('chat-title');
      if (chatTitleEl) {
        chatTitleEl.textContent = chat.title || chatId;
      }

      selectedModel = chat.model;
      if (modelSelector) {
        modelSelector.value = chat.model;
      }
      displayChatMessages(chat.messages);

      if (chat.context_files && Array.isArray(chat.context_files)) {
        chat.context_files.forEach(filename => {
          addBackendFileUpload(filename);
        });
      }

      // **Oppdater `titleToChatIdMap` hvis tittelen har endret seg**
      // Dette er nødvendig hvis loadChat henter en chat med en ny tittel
      const chatTitle = chat.title || chatId;
      if (!Object.keys(titleToChatIdMap).includes(chatTitle)) {
        titleToChatIdMap[chatTitle] = chatId;
        const option = document.createElement('option');
        option.value = chatTitle;
        option.textContent = chatTitle;
        chatSelector.appendChild(option);
      }

      // Sett valgt chat i dropdown
      chatSelector.value = chatTitle;

      console.log(`loadChat: Lastet inn chat med ID: ${chatId} og tittel: ${chatTitle}`);
    } else {
      console.warn("Chat ikke funnet, oppretter ny chat.");
      currentChatId = await createNewChat();
      appendMessageToChat("assistant", "Ny chat opprettet. Hvordan kan jeg hjelpe deg?");
    }
  } catch (error) {
    console.error("Feil ved lasting av chat:", error);
    alert("Feil ved lasting av chat.");
  }
}

/**
 * handleFileSelection
 */
function handleFileSelection(event) {
  const fileUploadDiv = event.target.closest('.w-file-upload');
  if (!fileUploadDiv) return;

  const allFileUploads = document.querySelectorAll('.w-file-upload');
  const selectedFilesCount = Array.from(allFileUploads).filter(uploadDiv => {
    const successView = uploadDiv.querySelector('.w-file-upload-success');
    return successView && !successView.classList.contains('w-hidden');
  }).length;

  if (selectedFilesCount >= 5) {
    return;
  }

  if (event.target.files && event.target.files[0]) {
    const file = event.target.files[0];
    const defaultView = fileUploadDiv.querySelector('.w-file-upload-default');
    const uploadSuccess = fileUploadDiv.querySelector('.w-file-upload-success');
    const fileNameDiv = uploadSuccess.querySelector('.w-file-upload-file-name');

    if (defaultView && uploadSuccess && fileNameDiv) {
      fileNameDiv.textContent = file.name;
      uploadSuccess.classList.remove('w-hidden');
      defaultView.classList.add('w-hidden');
    }
    const removeButton = uploadSuccess.querySelector('.w-file-remove-link');
    if (removeButton) {
      removeButton.addEventListener('click', function () {
        removeFileUpload(fileUploadDiv);
      });
    }
    if (selectedFilesCount < 5) {
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
                 id="${newId}">
          <label for="${newId}" role="button" class="button-3 w-file-upload-label">
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
          <div class="w-file-upload-error-msg">Upload failed. Max size for files is 10 MB.</div>
        </div>`;

      fileUploadDiv.parentNode.insertBefore(newUploadDiv, fileUploadDiv.nextSibling);
      const newInput = newUploadDiv.querySelector('.w-file-upload-input');
      if (newInput) {
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
 * setupEventListeners
 */
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
  if (deepbButton) {
    deepbButton.addEventListener('click', handleDeepBSearch);
    deepbButton.setAttribute('type', 'button');
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
}

/**
 * updateChatSelector
 */
async function updateChatSelector(newChatId) {
  await fetchChats(false);
  if (chatSelector) {
    const newChatTitle = Object.keys(titleToChatIdMap).find(
      title => titleToChatIdMap[title] === newChatId
    );
    if (newChatTitle) {
      chatSelector.value = newChatTitle;
      await loadChat(newChatId);
    }
  }
}


/**
 * onConfirmDelete
 */
function onConfirmDelete() {
  if (!currentChatId) return;
  
  if (deleteConfirmation) {
    deleteConfirmation.style.display = 'none';
  }
  if (overlay) {
    overlay.style.display = 'none';
  }
  
  onDeleteChat();
}

/**
 * onCancelDelete
 */
function onCancelDelete() {
  if (deleteConfirmation) {
    deleteConfirmation.style.display = 'none';
  }
  if (overlay) {
    overlay.style.display = 'none';
  }
}

/**
 * Initialize application
 */
async function initializeApp() {
  try {
    console.log("Starter initialisering...");

    // 1) Hent modeller
    await fetchModels();
    console.log("Modeller hentet");

    // 2) Hent long-context valg
    await populateLongSelector();
    console.log("Long-context valg hentet");

    // 3) Hent eksisterende chatter og fyll ut chat-selector
    const existingChats = await fetchChats(false); // Sett autoLoad til false for ikke å laste inn chats automatisk
    console.log("fetchChats: Hentet chats:", existingChats);

    // 4) Opprett en ny chat og sett currentChatId til den
    currentChatId = await createNewChat();
    console.log("Ny chat opprettet som den aktive chatten:", currentChatId);

    // 5) Last inn den nye chatten i chat-messages
    if (chatMessages) {
      chatMessages.innerHTML = '';
    }
    appendMessageToChat("assistant", renderMarkdown("Ny chat opprettet. Hvordan kan jeg hjelpe deg?"));

    // 6) Sett opp event listeners
    setupEventListeners();
    console.log("Event listeners satt opp");

    // 7) Oppdater input-stil
    if (chatInput) {
      chatInput.style.color = "#000";
    }

    // 8) Sett opp fil-opplastinger
    const initialFileInputs = document.querySelectorAll('.w-file-upload-input');
    initialFileInputs.forEach(input => {
      input.addEventListener('change', handleFileSelection);
    });

    console.log("Initialisering fullført");
  } catch (error) {
    console.error("Feil under initialisering:", error);
  }
}

// Kjør initializeApp når dokumentet er klart
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});
