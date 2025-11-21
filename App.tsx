import React, { useEffect, useRef, useState } from 'react';
import { useLiveChat, PropertyDetails } from './hooks/useLiveChat';
import { ConnectionState, Role } from './types';
import ChatBubble from './components/ChatBubble';
import StatusIndicator from './components/StatusIndicator';
import Icon from './components/Icon';

const App: React.FC = () => {
  const { connectionState, chatHistory, interimTranscript, startSession, stopSession, sessionError } = useLiveChat();
  const [propertyDetails, setPropertyDetails] = useState<PropertyDetails | null>(null);
  const [configId, setConfigId] = useState<string | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  
  const chatContainerRef = useRef<HTMLDivElement>(null);
  
  const isConversationActive = connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING;

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const gistId = params.get('configId');

        if (!gistId) {
          throw new Error("ID di configurazione mancante nell'URL. Assicurati che il link contenga '?configId=IL_TUO_ID'.");
        }
        
        setConfigId(gistId);

        const gistApiUrl = `https://api.github.com/gists/${gistId}`;
        const gistResponse = await fetch(gistApiUrl);
        if (!gistResponse.ok) {
            throw new Error(`Impossibile trovare il Gist con ID '${gistId}'. Controlla che l'ID sia corretto e che il Gist sia pubblico.`);
        }
        const gistData = await gistResponse.json();
        
        const jsonFile = Object.values(gistData.files).find(
          (file: any) => file.type === 'application/json' || file.filename.endsWith('.json')
        );

        if (!jsonFile || !(jsonFile as any).raw_url) {
            throw new Error("Nessun file .json trovato in questo Gist.");
        }
        
        const rawUrl = (jsonFile as any).raw_url;
        
        const configResponse = await fetch(rawUrl);
        if (!configResponse.ok) {
          throw new Error(`Errore nel caricamento del file di configurazione da: ${rawUrl}`);
        }
        
        const data: PropertyDetails = await configResponse.json();
        setPropertyDetails(data);

      } catch (error: any) {
        console.error("Impossibile caricare la configurazione:", error);
        setConfigError(error.message || "Errore sconosciuto durante il caricamento della configurazione.");
      } finally {
        setIsLoadingConfig(false);
      }
    };

    fetchConfig();
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, interimTranscript]);

  const handleToggleConversation = () => {
    if (isConversationActive) {
      stopSession();
    } else if (propertyDetails && configId) { 
      // Pass both details and configId for usage tracking
      startSession(propertyDetails, configId);
    }
  };
  
  const renderWelcomeScreen = () => {
     if (chatHistory.length === 0 && !isConversationActive) {
        const userLang = navigator.language.split('-')[0]; // 'en', 'it', 'fr', etc.

        // Default English message (fallback)
        let welcomeTitle = 'Welcome!';
        let welcomeText = 'I am your virtual assistant. I speak every language! Feel free to speak in your native language, and I will answer you in the same language. Press the button below to start.';
        
        switch (userLang) {
          case 'it':
            welcomeTitle = 'Benvenuto!';
            welcomeText = 'Sono il tuo assistente virtuale. Parlo tutte le lingue! Sentiti libero di parlare nella tua lingua madre, ti risponderò nella stessa lingua. Premi il pulsante in basso per iniziare.';
            break;
          case 'fr':
            welcomeTitle = 'Bienvenue !';
            welcomeText = 'Je suis votre assistant virtuel. Je parle toutes les langues ! N\'hésitez pas à parler dans votre langue maternelle, je vous répondrai dans la même langue. Appuyez sur le bouton ci-dessous pour commencer.';
            break;
          case 'es':
            welcomeTitle = '¡Bienvenido!';
            welcomeText = 'Soy tu asistente virtual. ¡Hablo todos los idiomas! Siéntete libre de hablar en tu lengua materna, te responderé en el mismo idioma. Presiona el botón de abajo para comenzar.';
            break;
          case 'de':
            welcomeTitle = 'Willkommen!';
            welcomeText = 'Ich bin Ihr virtueller Assistent. Ich spreche alle Sprachen! Fühlen Sie sich frei, in Ihrer Muttersprache zu sprechen, und ich werde Ihnen in derselben Sprache antworten. Drücken Sie den Knopf unten, um zu beginnen.';
            break;
          case 'pt':
            welcomeTitle = 'Bem-vindo!';
            welcomeText = 'Sou o seu assistente virtual. Falo todas as línguas! Sinta-se à vontade para falar na sua língua materna e eu responderei no mesmo idioma. Pressione o botão abaixo para começar.';
            break;
        }

        return (
             <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center p-4">
                <Icon name="microphone" className="w-20 h-20 mb-6 text-slate-600"/>
                <h2 className="text-3xl font-bold text-slate-300 mb-2">{welcomeTitle}</h2>
                <p className="max-w-sm">{welcomeText}</p>
            </div>
        );
    }
    return null;
  }

  const renderContent = () => {
    if (isLoadingConfig) {
      return <div className="flex items-center justify-center h-full">Caricamento configurazione...</div>;
    }
  
    if (configError) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-red-900/20 text-red-300 p-8 text-center rounded-lg">
          <h2 className="text-2xl font-bold mb-4">Errore di Configurazione</h2>
          <p className="max-w-md">{configError}</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full">
        <header className="bg-slate-900/50 backdrop-blur-sm border-b border-slate-700 p-4 text-center">
          <h1 className="text-lg font-semibold text-slate-200">Assistente AI per Ospiti</h1>
          <p className="text-sm text-slate-400 truncate">{propertyDetails?.address}</p>
        </header>
        
        <main ref={chatContainerRef} className="flex-1 p-4 md:p-6 overflow-y-auto space-y-4">
          {renderWelcomeScreen()}
          {chatHistory.map((msg, index) => (
            <ChatBubble 
              key={index} 
              role={msg.role} 
              text={msg.text} 
              groundingChunks={msg.groundingChunks}
            />
          ))}
          {interimTranscript && (
            <ChatBubble role={Role.USER} text={interimTranscript} isInterim={true} />
          )}
        </main>
  
        <footer className="bg-slate-900/50 backdrop-blur-sm p-4 border-t border-slate-700">
          <div className="max-w-2xl mx-auto flex flex-col items-center space-y-4">
            <StatusIndicator state={connectionState} />
            {connectionState === ConnectionState.ERROR && sessionError && (
              <p className="text-sm text-red-400 text-center px-4">{sessionError}</p>
            )}
            <button
              onClick={handleToggleConversation}
              disabled={!propertyDetails || connectionState === ConnectionState.CONNECTING}
              className={`
                w-20 h-20 rounded-full flex items-center justify-center text-white transition-all duration-300 shadow-lg
                ${isConversationActive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}
                disabled:bg-slate-600 disabled:cursor-not-allowed
                focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-slate-900 
                ${isConversationActive ? 'focus:ring-red-500/50' : 'focus:ring-blue-500/50'}
                ${connectionState === ConnectionState.CONNECTING ? 'animate-pulse' : ''}
              `}
              aria-label={isConversationActive ? 'Interrompi conversazione' : 'Avvia conversazione'}
            >
              <Icon name={isConversationActive ? 'stop' : 'microphone'} className="w-9 h-9"/>
            </button>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center h-screen p-0 md:p-4">
      <div className="w-full h-full max-w-2xl bg-slate-800/50 shadow-2xl rounded-none md:rounded-2xl overflow-hidden flex flex-col border border-slate-700">
        {renderContent()}
      </div>
    </div>
  );
};

export default App;