import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ChatMessage, ConnectionState, Role } from '../types';
import { decode, decodeAudioData, createBlob } from '../services/audioUtils';

// Constants
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// LIMITS
const MAX_SESSION_TIME_MS = 5 * 60 * 1000; // 5 minutes per conversation
const MAX_DAILY_TIME_MS = 20 * 60 * 1000;  // 20 minutes per day

// In-memory AudioWorklet processor
const audioWorkletCode = `
  class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
    }
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input.length > 0 && input[0].length > 0) {
        this.port.postMessage(input[0]);
      }
      return true;
    }
  }
  registerProcessor('audio-processor', AudioProcessor);
`;


export interface PropertyDetails {
    address: string;
    checkIn: string;
    checkOut: string;
    rules: string;
    appliances: string;
    bookingPlatform?: string;
    checkInAndOutProcedures?: string;
    location?: {
        latitude: number;
        longitude: number;
    };
}

const createSystemInstruction = (details: PropertyDetails) => `**REGOLA PIÙ IMPORTANTE DI TUTTE: Identifica la lingua della domanda dell'utente e rispondi ESATTAMENTE in quella stessa lingua. Non tradurre MAI. Fornisci SEMPRE una risposta vocale.**
(ABSOLUTE MOST IMPORTANT RULE: Identify the language of the user's question and reply EXACTLY in that same language. NEVER translate. ALWAYS provide a spoken audio response.)

---

### **Il Tuo Ruolo: "Concierge Locale Esperto"**

Sei un assistente AI d'élite, specializzato nell'assistere gli ospiti di una struttura ricettiva. Il tuo unico scopo è fornire informazioni **specifiche, precise, pratiche e immediatamente utilizzabili**. La tua intera conoscenza deve essere focalizzata sulla città e sul quartiere specificati in questo indirizzo: **${details.address}**. Considera questo indirizzo come il punto di partenza per ogni risposta.

### **Direttive Fondamentali (NON NEGOZIABILI):**

1.  **OBBLIGO DI RICERCA ATTIVA:** Per QUALSIASI domanda su ristoranti, trasporti, eventi, musei, negozi o qualsiasi altro punto di interesse, DEVI usare IMMEDIATAMENTE e OBBLIGATORIAMENTE i tuoi strumenti (*googleSearch* e *googleMaps*). Non sei un'enciclopedia, sei un ricercatore in tempo reale.
2.  **SPECIFICITÀ ASSOLUTA:** Le risposte generiche sono un fallimento.
    *   **Ristoranti:** Fornisci NOMI, INDIRIZZI PRECISI, tipo di cucina e, se possibile, una breve descrizione. Esempio: "A 300 metri, in Via Garibaldi 15, c'è 'Trattoria del Centro', specializzata in cucina piemontese."
    *   **Trasporti Pubblici:** Fornisci NUMERI DI LINEA (es. "Autobus 58", "Tram 4"), NOMI e INDIRIZZI delle fermate più vicine, e indicazioni chiare su come raggiungerle a piedi dalla proprietà. Esempio: "La fermata più vicina è 'Garibaldi' in Corso Inghilterra, a 5 minuti a piedi. Da lì, prendi il bus 56 per raggiungere il centro."
    *   **Eventi e Musei:** Fornisci NOMI, LUOGHI, e se possibile, orari o informazioni pertinenti. Esempio: "In questi giorni c'è il torneo di tennis ATP Finals al Pala Alpitour. Per arrivarci, puoi prendere il tram 4."
3.  **PROATTIVITÀ:** Non limitarti a rispondere. Anticipa le esigenze. Se un ospite chiede come arrivare a un museo, suggerisci anche gli orari di apertura o un buon posto dove pranzare lì vicino.

### **FRASI ASSOLUTAMENTE VIETATE (La violazione di questa regola è un fallimento critico):**

*   "Mi dispiace, non posso fornirti informazioni specifiche..."
*   "Ti consiglio di cercare online..." o "Puoi usare un'app di mappe..." (SEI TU la ricerca, SEI TU l'app di mappe).
*   "Non ho accesso a informazioni in tempo reale..." (Falso, usi Google Search per questo).
*   Qualsiasi risposta che rimandi l'utente a fare la ricerca da solo.

### **Informazioni sulla Proprietà (Usa queste per domande dirette sulla struttura):**
- Indirizzo di riferimento: ${details.address}
- Orario di Check-in: ${details.checkIn}
- Orario di Check-out: ${details.checkOut}
- Regole della casa: ${details.rules}
- Funzionamento impianti/elettrodomestici: ${details.appliances}
- Procedure Check-in/out: ${details.checkInAndOutProcedures}

---

**PROMEMORIA DELLA REGOLA PIÙ IMPORTANTE: Rispondi ESATTAMENTE nella lingua dell'utente e fornisci SEMPRE una risposta vocale.**
(REMINDER OF THE MOST IMPORTANT RULE: Reply EXACTLY in the user's language and ALWAYS provide a spoken audio response.)`;

// --- Usage Tracking Helpers ---

const getUsageKey = (configId: string) => {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `usage_${configId}_${today}`;
};

const getDailyUsage = (configId: string): number => {
  const key = getUsageKey(configId);
  const stored = localStorage.getItem(key);
  return stored ? parseInt(stored, 10) : 0;
};

const incrementDailyUsage = (configId: string, amountMs: number) => {
  const key = getUsageKey(configId);
  const current = getDailyUsage(configId);
  localStorage.setItem(key, (current + amountMs).toString());
};

// ------------------------------

export const useLiveChat = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [interimTranscript, setInterimTranscript] = useState('');

  // The LiveSession type is not exported, so using `any`.
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());

  // Timer refs for limits
  const sessionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const usageIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const stopSession = useCallback(async () => {
    // Clear limit timers
    if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
    if (usageIntervalRef.current) clearInterval(usageIntervalRef.current);
    sessionTimeoutRef.current = null;
    usageIntervalRef.current = null;

    if (sessionPromiseRef.current) {
        try {
            const session = await sessionPromiseRef.current;
            session.close();
        } catch (error) {
            console.error("Error closing session:", error);
        }
    }

    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (audioWorkletNodeRef.current) {
        audioWorkletNodeRef.current.disconnect();
    }
    if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
    }
    
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
        await inputAudioContextRef.current.close();
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        await outputAudioContextRef.current.close();
    }

    sessionPromiseRef.current = null;
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    streamRef.current = null;
    mediaStreamSourceRef.current = null;
    audioWorkletNodeRef.current = null;
    
    setConnectionState(ConnectionState.DISCONNECTED);
    // Note: We intentionally do not clear sessionError here if it was set by the limit enforcer
    setInterimTranscript('');
  }, []);

  const startSession = useCallback(async (details: PropertyDetails, configId: string) => {
    if (connectionState !== ConnectionState.DISCONNECTED) return;

    // 1. CHECK DAILY LIMIT BEFORE STARTING
    const currentDailyUsage = getDailyUsage(configId);
    if (currentDailyUsage >= MAX_DAILY_TIME_MS) {
        setSessionError("Limite giornaliero raggiunto. Riprova domani.");
        setConnectionState(ConnectionState.ERROR);
        return;
    }

    setConnectionState(ConnectionState.CONNECTING);
    setSessionError(null);
    setInterimTranscript('');
    setChatHistory([]); // Start with a fresh chat history

    try {
      const apiKey = import.meta.env.VITE_API_KEY;
      if (!apiKey) {
        throw new Error("La chiave API non è configurata. Assicurati che API_KEY sia impostata correttamente nell'ambiente di deploy (es. Netlify).");
      }
      
      const ai = new GoogleGenAI({ apiKey });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const systemInstruction = createSystemInstruction(details);
      
      const config: any = {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
        systemInstruction: systemInstruction,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      };
      
      if (details.location?.latitude && details.location?.longitude) {
        // Use both Maps and Search for comprehensive local info
        config.tools = [{googleMaps: {}}, {googleSearch: {}}];
        config.toolConfig = {
          retrievalConfig: {
            latLng: {
              latitude: details.location.latitude,
              longitude: details.location.longitude
            }
          }
        };
      }

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config,
        callbacks: {
          onopen: async () => {
            setConnectionState(ConnectionState.CONNECTED);

            // 2. START SESSION TIMER (Max duration per call)
            sessionTimeoutRef.current = setTimeout(() => {
                setSessionError("Tempo massimo per conversazione raggiunto (5 min).");
                stopSession();
            }, MAX_SESSION_TIME_MS);

            // 3. START DAILY USAGE TRACKER (Updates every 5 seconds)
            usageIntervalRef.current = setInterval(() => {
                const intervalMs = 5000;
                incrementDailyUsage(configId, intervalMs);
                
                // Check if limit exceeded during call
                if (getDailyUsage(configId) >= MAX_DAILY_TIME_MS) {
                    setSessionError("Limite giornaliero raggiunto (20 min).");
                    stopSession();
                }
            }, 5000);

            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });

            const blob = new Blob([audioWorkletCode], { type: 'application/javascript' });
            const workletURL = URL.createObjectURL(blob);

            try {
              await inputAudioContextRef.current.audioWorklet.addModule(workletURL);
            } catch(e: any) {
                console.error("Error adding audio worklet module", e);
                setSessionError(`Errore audio: ${e.message}`);
                setConnectionState(ConnectionState.ERROR);
                stopSession();
                return;
            } finally {
                URL.revokeObjectURL(workletURL);
            }

            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
            mediaStreamSourceRef.current = source;
            const workletNode = new AudioWorkletNode(inputAudioContextRef.current, 'audio-processor');
            audioWorkletNodeRef.current = workletNode;

            workletNode.port.onmessage = (event) => {
              const pcmBlob = createBlob(event.data);
              sessionPromiseRef.current!.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(workletNode);
            workletNode.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            handleTranscription(message);
            await handleAudio(message);
          },
          onerror: (e: any) => {
            console.error("Session error:", e);
            const errorMessage = e.message || 'Errore di connessione sconosciuto.';
            setSessionError(`Errore di sessione: ${errorMessage}`);
            setConnectionState(ConnectionState.ERROR);
            stopSession();
          },
          onclose: (e: CloseEvent) => {
            stopSession();
          },
        },
      });

    } catch (error: any) {
      console.error("Failed to start session:", error);
      setSessionError(error.message || "Impossibile avviare la sessione.");
      setConnectionState(ConnectionState.ERROR);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState]);

  const handleTranscription = (message: LiveServerMessage) => {
    if (message.serverContent?.outputTranscription) {
        currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
    } else if (message.serverContent?.inputTranscription) {
        const text = message.serverContent.inputTranscription.text;
        currentInputTranscriptionRef.current += text;
        const fullTranscript = currentInputTranscriptionRef.current.trim();
        if (fullTranscript) {
            setInterimTranscript(fullTranscript);
        }
    }

    if (message.serverContent?.turnComplete) {
        const fullInput = currentInputTranscriptionRef.current.trim();
        const fullOutput = currentOutputTranscriptionRef.current.trim();
        const groundingChunks = (message.serverContent?.modelTurn as any)?.groundingMetadata?.groundingChunks;
        
        currentInputTranscriptionRef.current = '';
        currentOutputTranscriptionRef.current = '';
        setInterimTranscript('');
        
        if (fullInput) {
            setChatHistory(prev => [...prev, { role: Role.USER, text: fullInput }]);
        }
        if (fullOutput) {
            setChatHistory(prev => [...prev, { role: Role.MODEL, text: fullOutput, groundingChunks }]);
        }
    }
  };

  const handleAudio = async (message: LiveServerMessage) => {
    const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
    if (base64Audio && outputAudioContextRef.current) {
        const outputCtx = outputAudioContextRef.current;
        nextStartTimeRef.current = Math.max(
          nextStartTimeRef.current,
          outputCtx.currentTime,
        );
        const audioBuffer = await decodeAudioData(
            decode(base64Audio),
            outputCtx,
            OUTPUT_SAMPLE_RATE,
            1,
        );
        const source = outputCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputCtx.destination);
        source.addEventListener('ended', () => {
            audioSourcesRef.current.delete(source);
        });

        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
        audioSourcesRef.current.add(source);
    }
    
    const interrupted = message.serverContent?.interrupted;
    if (interrupted) {
        for (const source of audioSourcesRef.current.values()) {
            source.stop();
            audioSourcesRef.current.delete(source);
        }
        nextStartTimeRef.current = 0;
    }
  };

  return { connectionState, chatHistory, interimTranscript, startSession, stopSession, sessionError };
};