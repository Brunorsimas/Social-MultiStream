# UniChat Overlay

Um overlay de chat para Windows que reúne conversas de transmissões ao vivo em uma única janela transparente, leve e sempre visível sobre jogos ou aplicativos em modo janela.

![Status](https://img.shields.io/badge/plataforma-Windows%2010%20%2F%2011-0078D4?logo=windows&logoColor=white)
![Chats](https://img.shields.io/badge/chats-YouTube%20%7C%20Twitch%20%7C%20Kick%20%7C%20TikTok%20LIVE-9146FF)

## O que é

O UniChat Overlay foi pensado para streamers que precisam acompanhar a audiência sem alternar entre o jogo e diversas abas do navegador. Cada plataforma pode ser exibida individualmente, em colunas ou agrupada em uma timeline única e identificada por origem.

O projeto toma como inspiração de experiência de uso o [Transparent Twitch Chat Overlay](https://github.com/baffler/Transparent-Twitch-Chat-Overlay): uma janela pequena, posicionável, redimensionável e adequada para ficar sobre jogos em modo janela ou sem bordas. Esta é uma implementação independente; não reutiliza código, identidade visual ou licença do projeto de referência.

## Principais recursos

- Chats ao vivo de **YouTube**, **Twitch**, **Kick** e **TikTok LIVE**, de acordo com a disponibilidade e autorização oficial de cada plataforma.
- **Chat unificado**: mensagens de todas as fontes ativas em uma só timeline, com ícone e cor que identificam sua origem.
- Visualização por chat individual, colunas ou grade.
- Janela transparente, sempre no topo, arrastável e redimensionável.
- Modos de edição, overlay limpo e **clique através** para interagir diretamente com o jogo.
- Atalhos globais, controle de opacidade, fonte, cores, filtros, pausas e histórico de mensagens.
- Conexões independentes: uma falha ou reconexão não interrompe os demais chats.
- Ícone na bandeja do sistema, inicialização com o Windows e persistência segura das preferências.

## Como a janela funciona

| Modo | Comportamento |
| --- | --- |
| **Editar** | Exibe bordas e controles para mover, redimensionar e configurar o overlay. |
| **Overlay** | Oculta os controles para deixar somente as mensagens visíveis. |
| **Clique através** | Faz os cliques do mouse passarem pelo overlay para o jogo ou aplicativo abaixo. |

O usuário poderá escolher monitor, posição, dimensões, opacidade e atalho para alternar rapidamente entre os modos.

## Integrações

| Plataforma | Forma de integração prevista |
| --- | --- |
| Twitch | OAuth e interfaces oficiais de chat, com validação de canal, renovação de token e reconexão. |
| YouTube | OAuth e YouTube Data API para localizar e ler o chat ativo de uma transmissão. |
| Kick | APIs, OAuth ou mecanismos explicitamente autorizados e disponíveis para o canal/conta. |
| TikTok LIVE | Integração oficial ou autorizada; recursos que dependam de aprovação/parceria devem informar esse requisito ao usuário. |

O aplicativo não deve depender de cookies copiados do navegador, scraping frágil, burla de autenticação, CAPTCHA ou mecanismos que contrariem os termos das plataformas.

## Privacidade e confiabilidade

Credenciais e tokens devem permanecer protegidos no computador do usuário, usando os mecanismos de segurança do Windows. A aplicação deve exibir claramente o estado de cada conexão — conectado, conectando, reconectando ou erro — e oferecer diagnósticos sem expor dados sensíveis.

Mensagens são normalizadas, ordenadas e deduplicadas para que a timeline unificada permaneça estável mesmo quando uma fonte se reconecta.

## Documento técnico

Os requisitos detalhados de implementação, arquitetura Windows, comportamento de cada conector, critérios de aceite e práticas de segurança estão em [Prompt PC.md](<Prompt PC.md>).

## Público-alvo

Streamers com um ou mais monitores, especialmente quem joga em tela cheia sem bordas ou em modo janela e precisa ler o chat sem deixar o conteúdo principal.
