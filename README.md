# Unichat

Aplicativo Expo/React Native para acompanhar vários chats de transmissões em uma única tela. Os chats e as preferências são armazenados localmente; não é necessário criar uma conta no aplicativo.

## Uso

1. Na tela inicial, toque em **Add Chat**.
2. Informe um nome e a URL do canal ou da transmissão. Para o YouTube, use uma URL `watch`, `live`, `youtu.be`, `shorts` ou `embed` que contenha o ID do vídeo.
3. Use **Manage** para ativar, fixar, editar, remover, reordenar ou abrir um chat individual.
4. Abra **MultiChat** para alternar entre colunas, grade, lista e abas.
5. Ative **Unified Mode** para capturar e ordenar as mensagens em uma única timeline. O botão de pausa impede que novas mensagens interrompam a leitura.

No Android, a timeline unificada coleta mensagens nas WebViews locais. Na versão web, o isolamento entre origens impede a leitura do DOM de iframes de terceiros; por isso a coleta unificada web usa o relay do servidor somente para o Kick.

## Desenvolvimento

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run server:build
```

Para o relay web do Kick, execute também `npm run server:dev`. `EXPO_PUBLIC_DOMAIN` é opcional no navegador e necessário apenas quando a API estiver em outro domínio.

