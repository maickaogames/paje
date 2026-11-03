# Paje

Para instruir uma inteligência artificial a programar essa aplicação com foco em extremo desempenho e baixo uso de CPU/RAM, a melhor abordagem é especificar a stack de tecnologia leve (como Tauri + Rust ou C++ com WebRTC) e estruturar o prompt por módulos bem definidos.




Aqui está o comando (prompt) pronto para você copiar, colar e enviar para a IA dev:

Markdown

Atue como um Engenheiro de Software Sênior especializado em aplicações desktop de alta performance, tempo real e sistemas VoIP. Sua tarefa é criar todo o código e a arquitetura de um aplicativo estilo Discord leve para um grupo de amigos, focado no menor consumo possível de CPU e RAM para rodar simultaneamente com jogos pesados em computadores modestos.

### STACK TECNOLÓGICA RECOMENDADA
- **Framework:** Tauri (Rust no backend para gerenciamento leve de recursos e processos; HTML/CSS/JS nativo no frontend sem overhead do Electron).
- **Comunicação VoIP e Vídeo:** WebRTC (Peer-to-Peer para conexões diretas entre usuários, reduzindo necessidade de servidor robusto e latência).
- **Estilização UI:** HTML5 + Tailwind CSS + JS puramente reativo (sem frameworks pesados).

---

### FLUXO DE USUÁRIO E ARQUITETURA DE FUNCIONALIDADES

#### 1. Setup Inicial de Acesso (Sem Conta/Cadastro)
- **Modal de Identificação:** Ao abrir, solicita apenas um **Apelido (Nickname)** temporário.
- **Avatar:** Opção para carregar uma foto local (`.png`/`.jpg`) ou usar um ícone vetorial/padrão genérico.
- **Seleção de Periféricos:** Tela simples para definir:
  - Dispositivo de Entrada de Áudio (Microfone).
  - Dispositivo de Saída de Áudio (Fone/Alto-falante).
  - Dispositivo de Vídeo (Webcam).
  - *Comportamento:* Permitir a opção "Nenhum" para qualquer um dos dispositivos, desativando a funcionalidade correspondente no app.

#### 2. Barra Lateral (Navegação e Estrutura de Canais)
- **Canais de Voz Padrão (3 fixos):**
  - "Gameplay 1"
  - "Gameplay 2"
  - "AFK" (Auto-mutar entrada ao entrar neste canal).
- **Canal de Texto Padrão (1 fixo):**
  - Posicionado abaixo dos canais de voz. Permite envio de mensagens, links (com renderização básica de preview) e imagens.
- **Painel de Controle Rápido (Inferior):**
  - Botão de Mutar Microfone (Entrada).
  - Botão de Deafen/Surdina (Silencia Entrada e Saída simultaneamente).
  - Botão Ligar/Desligar Webcam.
  - Botão "Usar Celular como Webcam" (Gera um QR Code dinâmico + URL para streaming WebRTC direto da câmera do smartphone).

#### 3. Área Principal (Corpo do Aplicativo)
- **Modo Canal de Texto:**
  - Timeline de mensagens no estilo chat clássico, exibindo: `[Hora] Avatar + Nickname: Mensagem`.
- **Modo Canal de Voz / Vídeo:**
  - Grid dinâmico exibindo as fotos de perfil dos membros presentes na sala.
  - Se a Webcam/Stream estiver ativa, substitui a foto do usuário pelo feed de vídeo em tempo real.
  - **Indicador de Fala:** Borda verde ao redor do avatar/vídeo ativada via VAD (Voice Activity Detection) para consumo eficiente.

#### 4. Gerenciamento de Membros no Canal de Voz
- **Controle de Volume Individual:** Slider ao clicar com o botão direito sobre qualquer usuário no canal de voz para ajustar o ganho de áudio dele localmente.
- **Mover Usuários:** Permite arrastar e soltar (Drag and Drop) um amigo de um canal de voz para outro.

#### 5. Transmissão de Tela (Screen Share)
- Opção para compartilhar **Tela Inteira** ou **Janela Específica** (Jogos/Navegador).
- **Configuração de Transmissão:** Suporte a 1080p a 60fps com aceleração de hardware ativada.
- **Interface de Exibição:** 
  - Transmissão renderizada no corpo principal para os outros usuários.
  - Botão de **Fullscreen (Tela Cheia)**.
  - Controle de volume exclusivo do áudio da transmissão.
  - Botão visível de **"Encerrar Transmissão"**.

---

### FUNCIONALIDADES EXTRA PARA MELHORIA DE UX (Manter Leveza)

1. **Overlay no Jogo (Minimalista):** Pequena sobreposição transparente personalizável mostrando quem está falando no momento no canto da tela sem perder FPS.
2. **Push-to-Talk (Pressionar para Falar) & Hotkeys:** Atalhos globais de teclado configuráveis para Mute, Deafen e Push-to-Talk.
3. **Indicador de Ping/Qualidade de Conexão:** Ícone discreto mostrando a latência (ms) da conexão Peer-to-Peer.
4. **Modo Economia de Energia:** Opção de pausar a renderização visual da UI e feeds de vídeo quando o aplicativo estiver minimizado durante a partida.

---

### INSTRUÇÕES DE DESENVOLVIMENTO
1. Priorize código limpo, modular e sem dependências pesadas em segundo plano.
2. Forneça a estrutura de pastas do projeto, as configurações do Tauri/Rust e o código-fonte dos componentes frontend e backend WebRTC.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://paje.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/73686829-b49e-4852-9685-faf7a6ace3f0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
