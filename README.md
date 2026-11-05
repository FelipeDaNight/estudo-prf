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
