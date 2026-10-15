# Evitar que espectadores ouçam a própria voz no compartilhamento de tela

## Problema
Quando alguém compartilha a tela com o áudio do computador inteiro, as vozes dos outros participantes (que saem pelos alto-falantes de quem transmite) voltam para a sala junto com o som do jogo. Resultado: cada espectador ouve a própria voz duplicada, com atraso, vindo da transmissão.

## Solução
Ativar o cancelamento de eco do navegador na trilha de áudio do compartilhamento de tela. Hoje, em `src/lib/rtc.ts` (função `startShare`), a captura é feita com `echoCancellation: false, noiseSuppression: false, autoGainControl: false`. O plano é:

1. **Ligar `echoCancellation: true`** na trilha de áudio do `getDisplayMedia`. O navegador passa a remover da transmissão os sons que ele mesmo está reproduzindo nos alto-falantes — ou seja, as vozes dos outros participantes da sala não voltam pela transmissão.
2. **Manter `noiseSuppression: false` e `autoGainControl: false`** para não degradar o som do jogo (supressão de ruído e ganho automático tendem a "achatar" música e efeitos).
3. **Teste prático recomendado**: duas pessoas em redes distintas, uma transmitindo com áudio do sistema, a outra falando — confirmar que a voz não retorna pela transmissão.

## Limitações (transparência)
- O cancelamento de eco funciona melhor quando as vozes saem pelos **alto-falantes** do mesmo computador que transmite. Quem usa **fone de ouvido** já não tem esse retorno (o som não vaza), então nada muda para eles.
- O suporte varia por navegador: Chrome/Edge aplicam o cancelamento de eco nesse cenário; em outros navegadores o efeito pode ser parcial.
- Não é possível separar "só o som do jogo" do som da voz dentro do áudio do sistema — o cancelamento de eco é a técnica correta para esse caso.

## Mudanças técnicas
- `src/lib/rtc.ts`: alterar as restrições de áudio em `startShare` (`echoCancellation: true`).
- Sem mudanças de interface, banco de dados ou configuração.
