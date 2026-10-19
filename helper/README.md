# Pajé Audio Helper (Windows)

Componente auxiliar nativo que captura o áudio **de um único processo** (jogo ou
programa) via WASAPI *Application Loopback Capture* e o entrega ao aplicativo web
Pajé por WebSocket local. O Discord e demais programas **nunca** entram na
captura, por construção.

> **Estado:** implementação de referência. Deve ser compilada e validada em um
> computador Windows — este repositório não inclui binários.

## Requisitos

- Windows 10 versão 2004 (build 19041) ou superior, ou Windows 11.
  A captura por processo (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`)
  não existe em versões anteriores; o helper detecta e encerra com mensagem clara.
- Rust stable (`rustup`) para compilar.

## Como compilar e executar

```powershell
cd helper
cargo build --release
.\target\release\paje-audio-helper.exe
```

O helper permanece rodando em segundo plano enquanto o usuário transmite.
Distribua o `.exe` aos usuários (assinatura de código recomendada para evitar
avisos do SmartScreen).

## Protocolo local (ws://127.0.0.1:47820)

- Escuta **somente** em `127.0.0.1` (loopback) — nunca em outras interfaces.
- Subprotocolo WebSocket obrigatório: `paje-audio-v1`.
- O cabeçalho `Origin` é validado contra uma lista permitida
  (`https://paje.lovable.app`, `http://localhost:*`, `https://*.lovable.app`,
  `https://*.lovableproject.com`). Conexões de outras origens são recusadas.
- Mensagens de controle (JSON, texto):
  - `{"type":"list"}` → resposta `{"type":"processes","processes":[{"pid":1234,"name":"jogo.exe"}]}`
  - `{"type":"select","pid":1234}` → escolhe o processo; resposta `{"type":"selected","pid":1234}`
  - `{"type":"start"}` → inicia o envio de áudio
  - `{"type":"stop"}` → encerra o envio; resposta `{"type":"stopped"}`
  - `{"type":"error","message":"..."}` → falha (ex.: processo encerrado)
- Áudio: frames **binários** PCM `f32le`, estéreo interleavado, 48 000 Hz,
  em blocos de 480 amostras por canal (10 ms).

## Segurança

- Nenhum endpoint sem validação de origem e subprotocolo.
- A captura só começa após seleção explícita do processo pelo usuário.
- Ao fechar a conexão, a captura é encerrada e os recursos liberados.
- O áudio vai apenas para a página conectada; nada é enviado a terceiros.

## Alternativa sem o helper (Windows incompatível)

Sem o helper, o Pajé transmite tela/janela **sem áudio** (somente abas do
navegador levam som). Uma alternativa manual é um dispositivo de áudio virtual
(ex.: VB-Cable): o usuário direciona a saída do jogo para o dispositivo virtual
e compartilha esse dispositivo — configuração manual, fora do escopo deste
componente.
