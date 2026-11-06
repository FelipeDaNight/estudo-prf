# Estudo PRF: app do iPhone + planilha

App que roda no navegador do iPhone (instalado na tela inicial) e grava na sua planilha do Google Sheets:
- **Estudo:** Pomodoro por matéria, minutos vão para a aba Horas.
- **Corrida:** GPS com distância, pace e teste de 12 minutos (grava em Corridas e na aba TAF).
- **TAF:** cronômetro e contador para abdominal, barra, flexão, agilidade, impulsão.
- **Academia:** séries com repetições e carga, descanso cronometrado (aba Academia).
- **Erro:** registro rápido no caderno de erros (aba Erros).

Sem internet o app guarda tudo no aparelho e envia depois.

## Instalação (cerca de 20 minutos, uma vez só)

### 1. Planilha no Google Sheets
1. Envie `planilha-concurso-v2.4-sheets.xlsx` para o Google Drive e abra com o Google Planilhas.
2. Arquivo > Salvar como Google Planilhas (para virar planilha nativa).
3. Em Ajustes da planilha, confira a data de início (uma segunda-feira).

### 2. Script que recebe os dados
1. Na planilha: Extensões > Apps Script.
2. Apague o código que aparece e cole o conteúdo de `apps-script/Code.gs`. Salve.
3. Engrenagem (Configurações do projeto) > Propriedades do script > Adicionar propriedade: nome `CHAVE`, valor uma senha longa inventada por você (20 letras e números ou mais). Anote essa chave.
4. Implantar > Nova implantação > tipo "App da Web". Executar como: **Eu**. Quem pode acessar: **Qualquer pessoa**. Implantar e autorizar o acesso à planilha quando o Google pedir.
5. Copie a **URL do app da Web** (termina em `/exec`).

Se você mudar o código depois, use Implantar > Gerenciar implantações > editar > Nova versão.

### 3. Colocar o app no ar (precisa de https para o GPS funcionar)
Opção simples e gratuita, GitHub Pages:
1. No GitHub, crie um repositório (por exemplo `estudo-prf`) e envie os arquivos `index.html`, `app.js`, `sw.js`, `manifest.webmanifest` e os três `.png`. Não precisa enviar a pasta `apps-script` nem `tests`.
2. Settings > Pages > Branch `main`, pasta `/ (root)`. Aguarde 1 a 2 minutos. O endereço será `https://SEU-USUARIO.github.io/estudo-prf/`.

### 4. No iPhone
1. Abra o endereço no **Safari**.
2. Compartilhar > Adicionar à Tela de Início.
3. Abra o app pelo ícone. Vá em **Ajustes**, cole a URL do script e a chave, toque em "Testar conexão e baixar listas". Deve aparecer "Conectado".
4. Quando o app pedir localização, permita (use "Ao usar o app").

## Modo Foco do iPhone (opcional)
O app não consegue ligar o Foco sozinho (o iOS não permite a sites). Ele convida: ao iniciar um foco, aparece "Ligar o modo Foco do iPhone?". Se você tocar em **Ativar Foco**, o app chama um atalho seu do app Atalhos.
1. App **Atalhos** > + (novo atalho) > adicionar a ação **Definir Foco** > Ativar > escolha o seu Foco (por exemplo "Estudo") e defina até quando (por exemplo "Até eu desligar").
2. Dê ao atalho o nome **Foco Estudo** (ou outro, e escreva o mesmo nome em Ajustes do app, no campo "Nome do atalho de Foco").
3. No app, ao iniciar o foco, toque em Ativar Foco. O iPhone abre o Atalhos por um instante; volte ao app (o cronômetro continua contando).
"Agora não" silencia o convite até amanhã; "Não perguntar mais" desliga o convite (reative em Ajustes). Para desligar o Foco depois, use o Centro de Controle.
Isto foi testado só no navegador simulado (o convite aparece e monta o link certo). Se o iPhone reclamar que não achou o atalho, confira o nome.

## Uso no dia a dia
- **Estudo:** escolha a matéria e toque em Iniciar foco. Ao fim dos 25 minutos o registro vai sozinho para a planilha.
- **Corrida:** toque em Iniciar, corra com o app aberto e a tela ligada, e em Finalizar confira distância e tempo antes de salvar. No tipo "Teste 12 min" o app para sozinho aos 12:00 e grava a marca em metros no TAF.
- **Academia:** digite o exercício (aparece a última carga usada), repetições e carga, e toque em Registrar série. O descanso começa sozinho.
- **Erro:** escolha o tópico, o tipo, a confiança e escreva a regra com suas palavras.
- O indicador no topo mostra quantos registros ainda não chegaram à planilha.

## Limites que você precisa conhecer
- **GPS no iPhone:** o navegador só atualiza a posição com o app aberto e a tela ligada. Se a tela bloquear, o app perde pontos; ao voltar, ele soma a distância em linha reta do trecho sem sinal e avisa na tela. Em pista de atletismo isso subestima a distância. Para a prova de 12 minutos, mantenha a tela ligada. Eu não consegui testar o GPS real num iPhone, só simulado.
- **Precisão:** o GPS do celular erra alguns metros. Para o teste do TAF, compare com uma pista medida ou com o Apple Fitness na primeira vez.
- **Avisos com a tela bloqueada:** o iPhone pode não tocar o alarme do Pomodoro com o app em segundo plano. O tempo fica certo (o app calcula pela hora do relógio), mas o aviso pode só aparecer quando você abrir o app.
- **Segurança:** a URL do script fica aberta a qualquer pessoa, protegida só pela chave. Não compartilhe a chave. Se vazar, mude o valor em Propriedades do script.
- **Não testado ao vivo:** a ligação com o Google (Apps Script) foi testada com uma planilha simulada, não com a sua. Na primeira vez, faça um registro de teste em cada aba e confira se caiu na linha certa.

## Como as abas recebem os dados
O script grava na primeira linha vazia das colunas azuis e não mexe nas colunas de fórmula. Cada registro tem um código único; se a resposta se perder e o app reenviar, o script não duplica.

## Testes
Na pasta `tests`: `node test_codegs.js` (script, com planilha simulada) e `node test_app.js` (app com navegador simulado, GPS simulado e relógio acelerado; precisa de Playwright e de um servidor local na porta 8765).


## Tela Hoje, desafios e visor de corrida

- **Hoje** é a primeira tela: anéis de estudo (dia), corridas e academia (semana), próxima ação sugerida, sequência de dias de estudo (1 folga por semana não quebra), desafios da semana e recordes. Os números vêm dos registros feitos neste aparelho.
- As metas ficam em **Ajustes > Metas dos desafios**.
- **Visor de corrida**: abre em tela cheia ao iniciar. Mostra tempo, km, pace atual e médio, trajeto, aviso por voz a cada km e pausa automática ao parar. Mantenha a tela ligada.

## Questões e simulados

Aba **Questões**: escolha um banco (ex.: CBMGO 2022) e use **Treinar** (por matéria; todas/novas/erradas) ou **Simulado completo**.
- Treino: feedback na hora (certo/errado + alternativa correta + justificativa), com "Certeza/Dúvida/Chute". Ao errar, aparece o tipo de erro e a regra (editável) e o erro vai sozinho para a aba **Erros** da planilha.
- Simulado: sem feedback até o fim, cronômetro, "Em branco". Em bancos Certo/Errado (Cebraspe) a nota é acertos − erros.
- Sessões viram linhas na aba **Questões** (por matéria|tópico); simulados vão para **Simulados** quando o banco pede.
- Tipos suportados: `mc` (A–E) e `ce` (Certo/Errado). Bancos ficam em `bancos/` (`index.json` + um JSON por prova).
- **Atenção:** depois de atualizar, cole o novo `apps-script/Code.gs` no Apps Script e implante uma *nova versão* (Implantar → Gerenciar implantações → editar → Nova versão).
- O gabarito do banco CBMGO 2022 é feito por mim (não oficial). Questões marcadas ⚠ têm confiança média.

### Questões (v2)
Lista com progresso, "Continuar", matérias em um toque (filtro Todas/Novas/Erradas), barra fixa Anterior/Pular/Próxima, botão "Salvar no caderno de erros" e "Auto" (avança sozinho ao acertar, exceto chute).

### Cartões (flashcards dos erros)
Todo erro (questão errada em treino/simulado ou erro manual) vira um cartão automaticamente. Em Questões → "Cartões de revisão": mostra a questão, "Mostrar resposta", e avalia Errei/Difícil/Bom/Fácil (revisão em 0/1/3/7/15/30/60 dias). Os cartões ficam no aparelho (localStorage); a planilha continua com o caderno de erros e a revisão dela. A Hoje sugere "Revisar cartões" quando há vencidos.

### Lei seca
Card na aba Hoje abre a tela "📖 Lei seca": plano por dia (semana 1: CP, Lei 14.133 e CPP), leitor por artigo com palavras-chave em destaque, ⭐ para mandar um artigo ao baralho, "Marcar como lido" e **Lacunas de hoje** (12 novas + as vencidas, com revisão espaçada). Os dados ficam em `bancos/leiseca-sem01.json` (listado em `bancos/lei-index.json`); novas semanas entram como novos arquivos.
