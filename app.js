const GIPHY_API_KEY = '';
const GEMINI_API_KEY = '';

document.addEventListener('DOMContentLoaded', async () => {
    const recordBtn = document.getElementById('record-btn');
    const btnText = document.getElementById('btn-text');
    const statusText = document.getElementById('status');
    const transcriptPreview = document.getElementById('transcript-preview');
    const resultsGrid = document.getElementById('results-grid');
    const aiWarning = document.getElementById('ai-warning');

    let isRecording = false;
    let recognition;
    let micStream;
    let geminiAvailable = true;

    // --- AI Health Check ---
    async function checkGeminiStatus() {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] })
            });
            if (!res.ok) throw new Error("API Key or Connection issue");
            geminiAvailable = true;
            aiWarning.style.display = 'none';
        } catch (e) {
            console.warn("Gemini AI check failed:", e);
            geminiAvailable = false;
            aiWarning.style.display = 'flex';
        }
    }
    
    // Check status on load
    checkGeminiStatus();

    // 1. Request persistent Mic access upfront to lock the permission
    async function initPersistentMic() {
        try {
            if (!micStream) {
                micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                console.log("Persistent mic stream acquired.");
            }
            return true;
        } catch (e) {
            console.error("Mic access denied:", e);
            statusText.textContent = "Mic access denied. Enable it in settings.";
            return false;
        }
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isRecording = true;
            recordBtn.classList.add('recording');
            btnText.textContent = 'Stop Recording';
            statusText.textContent = 'Listening...';
        };

        recognition.onresult = async (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    const rawTranscript = event.results[i][0].transcript;
                    
                    // Show "Correcting" status
                    statusText.textContent = 'AI is correcting sentence...';
                    const correctedTranscript = await correctTextWithGemini(rawTranscript);
                    statusText.textContent = 'Listening...';
                    
                    finalTranscript = correctedTranscript;
                    processTranscript(correctedTranscript, correctedTranscript);
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            
            if (transcriptPreview && (finalTranscript || interimTranscript)) {
                transcriptPreview.innerHTML = `<strong>${finalTranscript}</strong> <span style="color: #9ca3af">${interimTranscript}</span>`;
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error !== 'no-speech') {
                stopRecording();
                statusText.textContent = 'Error: ' + event.error;
            }
        };

        recognition.onend = () => {
            if (isRecording) {
                recognition.start(); // Auto-restart if we intended to be recording
            } else {
                stopRecording();
            }
        };

        function stopRecording() {
            isRecording = false;
            recordBtn.classList.remove('recording');
            btnText.textContent = 'Press here to record';
            statusText.textContent = 'Ready';
        }

        recordBtn.addEventListener('click', async () => {
            // Initialize mic stream on first click to lock permission
            const hasAccess = await initPersistentMic();
            if (!hasAccess) return;

            if (isRecording) {
                isRecording = false;
                recognition.stop();
            } else {
                resultsGrid.innerHTML = ''; 
                recognition.start();
            }
        });
    } else {
        statusText.textContent = 'Speech Recognition not supported.';
        recordBtn.disabled = true;
        btnText.textContent = 'Not Supported';
    }

    // --- Helper Functions ---
    async function correctTextWithGemini(text) {
        if (!geminiAvailable) return text;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const prompt = `Fix the grammar and sentence structure of this speech-to-text transcript. Keep it natural and concise. Only return the corrected sentence text, nothing else. Transcript: "${text}"`;

        const body = {
            contents: [{
                parts: [{ text: prompt }]
            }]
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            
            if (data.candidates && data.candidates[0].content.parts[0].text) {
                return data.candidates[0].content.parts[0].text.trim();
            }
            return text;
        } catch (error) {
            console.error("Gemini AI error:", error);
            aiWarning.style.display = 'flex';
            geminiAvailable = false;
            return text; // Fallback to original text
        }
    }

    async function processTranscript(text, fullSentence) {
        const words = text.toLowerCase().trim().split(/\s+/);
        const filteredWords = words.filter(word => word.length > 2);
        const uniqueWords = [...new Set(filteredWords)];

        for (const word of uniqueWords) {
            if (document.getElementById(`card-${word}`)) continue;
            createPlaceholderCard(word);
            fetchDataForWord(word, fullSentence);
        }
    }

    function createPlaceholderCard(word) {
        const card = document.createElement('div');
        card.className = 'card';
        card.id = `card-${word}`;
        card.innerHTML = `
            <div class="card-img-container">
                <div class="loader"></div>
            </div>
            <div class="card-content">
                <div class="card-title">${word}</div>
                <div class="card-definition">Loading definition...</div>
            </div>
        `;
        resultsGrid.appendChild(card);
    }

    async function fetchDataForWord(word, fullSentence) {
        try {
            const [gifUrl, definition] = await Promise.all([
                fetchSignGif(word, fullSentence),
                fetchDefinition(word)
            ]);
            updateCard(word, gifUrl, definition);
        } catch (error) {
            console.error(`Error fetching data for ${word}:`, error);
        }
    }

    async function fetchSignGif(word, fullSentence) {
        try {
            const response = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${word}+sign+language&limit=3&rating=g`);
            const data = await response.json();
            
            if (!data.data || data.data.length === 0) return null;
            if (data.data.length === 1 || !geminiAvailable) return data.data[0].images.fixed_height_small.url;

            // If multiple GIFs found, ask Gemini to pick the best one based on titles
            const options = data.data.map((gif, index) => `${index + 1}: ${gif.title}`).join('\n');
            const prompt = `In the sentence "${fullSentence}", which of these American Sign Language GIF titles is most appropriate for the word "${word}"? \n${options}\nReturn ONLY the number (1, 2, or 3).`;

            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
            const body = { contents: [{ parts: [{ text: prompt }] }] };

            const geminiResponse = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const geminiData = await geminiResponse.json();
            
            let bestIndex = 0;
            if (geminiData.candidates && geminiData.candidates[0].content.parts[0].text) {
                const aiChoice = parseInt(geminiData.candidates[0].content.parts[0].text.trim());
                if (!isNaN(aiChoice) && aiChoice >= 1 && aiChoice <= data.data.length) {
                    bestIndex = aiChoice - 1;
                }
            }

            return data.data[bestIndex].images.fixed_height_small.url;
        } catch (e) { 
            console.error("fetchSignGif error:", e);
            return null; 
        }
    }

    async function fetchDefinition(word) {
        try {
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
            const data = await response.json();
            return data[0]?.meanings[0]?.definitions[0]?.definition || "Definition not found.";
        } catch (e) { return "Unable to load definition."; }
    }

    function updateCard(word, gifUrl, definition) {
        const card = document.getElementById(`card-${word}`);
        if (!card) return;
        const imgContainer = card.querySelector('.card-img-container');
        const defContainer = card.querySelector('.card-definition');
        imgContainer.innerHTML = gifUrl ? `<img src="${gifUrl}" alt="${word}">` : `<div style="padding: 20px; color: #666">No GIF</div>`;
        defContainer.textContent = definition;
    }
});
