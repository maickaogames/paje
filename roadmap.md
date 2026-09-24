# Roadmap — Pajé (Bem-vindos à tribo Akidauânus!)

- [x] Ativar Lovable Cloud (DB, storage, realtime)
- [x] Design system leve (dark, tokens)
- [x] Entrada: senha do grupo + apelido + avatar + seleção de dispositivos ("Nenhum")
- [x] Barra lateral: Gameplay 1 / Gameplay 2 / AFK (auto-mute) + canal de texto
- [x] Voz P2P via WebRTC (mesh) com sinalização via Realtime broadcast/presence
- [x] VAD (borda verde), mute, deafen, push-to-talk, ping
- [x] Volume individual (clique direito), arrastar usuário entre canais
- [x] Webcam + grid de vídeo; celular como webcam (QR + página /cam/:id)
- [x] Screen share (janela/app, 1080p60), fullscreen, volume da transmissão, encerrar
- [x] Canal de texto: mensagens, imagens, preview de link
- [x] Modo economia (pausar vídeo quando aba oculta)
- [x] Senha do grupo (secret GROUP_PASSWORD)
- [x] Microfone: sensibilidade, supressor de ruído, ouvir-se
- [x] Suporte constante de conexão: stats (perda/jitter/RTT), 4 níveis de qualidade
      adaptativos, ICE restart e reconexão da sala automáticos
- [x] Correção do eco/retransmissão de vozes (áudio remoto em <audio> com AEC)
- [x] Exibição da câmera sem recorte (object-contain)
- [x] Áudio da transmissão: apenas a janela escolhida (systemAudio: exclude)
- [x] Nome/logo Pajé + slogan + favicon/ícones
- [x] Instalável no computador (manifest + ícones, sem service worker)
- [x] Sons das ações (mute, surdina, entrar/sair de voz, iniciar/encerrar transmissão)

## Limitações do navegador (não implementáveis aqui)
- Listar os aplicativos em execução: só o seletor do navegador pode fazê-lo.
- Overlay sobre o jogo e hotkeys globais fora da janela.
