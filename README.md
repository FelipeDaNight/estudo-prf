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

## Meus erros (Gran Questões) — banco privado
Aba Questões → "➕ Importar questões": cole o JSON (ou escolha o arquivo). As questões ficam só no aparelho (localStorage `ep_qpriv`), não no repositório público. Formato: `{"questoes":[{materia, topico, tipo:"ce"|"mc", resp, enunciado, alternativas?, just}]}`. Duplicadas são ignoradas. "Copiar backup" copia o banco.

## CTB (Lei 9.503/97)
`bancos/ctb-prf.json`: texto compilado do Planalto (04/11/2026), 364 artigos + 124 definições do Anexo I, em 43 dias. Cada infração tem ficha (natureza, pontos, multa-base, penalidade, medida administrativa); artigos alterados desde 2018 trazem "🔄 Texto alterado por". Na lei seca, o filtro Tudo / Semana 1 / CTB escolhe o caderno.

## Tela Hoje reorganizada
- **Checklist PRF 2021** no topo: o que caiu em cada item da prova objetiva (9/5/2021), por matéria, com gabarito (C, E ou anulada) e caixa para marcar o que já estudou. Funciona sem internet; o progresso fica no aparelho.
- **Lei seca (Semana 1)** e **CTB** agora são páginas separadas, cada uma com seus trechos, progresso e lacunas. O filtro "Tudo / Semana 1 / CTB" foi removido.

## CTB: revisão do texto (12/11/2026)
- Conferido artigo por artigo contra o texto compilado do Planalto: os 364 artigos em vigor e as 126 definições do Anexo I estão no app.
- Dispositivos **vetados ou revogados** agora aparecem em cinza (ex.: "Art. 11. (VETADO)", "§ 4º (VETADO)"), para a numeração não pular sem aviso. São 27 artigos e 132 parágrafos/incisos.
- Corrigidos: rótulo do Art. 7º-A, duas definições do Anexo I que estavam coladas em outras (luz de posição e luz indicadora de direção), a definição revogada de "patrulhamento" e pequenos erros de digitalização ("§ 2o", "Lei no").
- Capítulos I e II (dias 1 a 6) ganharam 98 lacunas escritas à mão, incluindo cartões "De quem é a competência?".

## Banco do Sócrates: fixação de Trânsito, Penal, Processo Penal e Legislação Especial (13/11/2026)
- Aba **Questões** → card **"Sócrates · Fixação PRF"**: 754 itens Certo/Errado no estilo Cebraspe, com justificativa citando o artigo. São os mesmos itens das aulas do Sócrates (assistente de voz), escritos e conferidos nas fontes oficiais, com as leis atualizadas até 13/11/2026 (Lei Antifacção, Leis 15.245/2025, 15.397/2026 e 15.487/2026, TCO pela PRF no STF, Decreto 11.348/2023).
- Matérias (14): Língua Portuguesa (82), Direito Penal (79), Legislação de Trânsito (104), Raciocínio Lógico-Matemático (66), Legislação Especial (62), Geopolítica (60), Direito Constitucional (57), Direito Processual Penal (50), Direito Administrativo (49), Ética e Cidadania (42), Informática (36), Física (33), Direitos Humanos (22) e Língua Inglesa (12).
- Ética: Código de Ética (Decreto 1.171/1994: ausência INJUSTIFICADA, pena de censura), Sistema de Gestão da Ética (Decreto 6.029/2007), LAI e Decreto 7.724 (com a mudança de 2023), conflito de interesses e nepotismo (primo é 4º grau) e governança (Decreto 9.203/2017). Direitos Humanos: teoria, tratados na CF (Convenção da Pessoa com Deficiência tem status de emenda), DUDH e Pacto de São José.
- Administrativo: organização, ato administrativo (Lei 9.784), agentes públicos e PAD (Lei 8.112), carreira de PRF (Lei 9.654 e Decreto 8.282: 120/150/360 horas para promoção), poderes e poder de polícia (STF, Tema 532), licitações pela Lei 14.133, controle, responsabilidade civil (dupla garantia, Tema 940) e princípios (nepotismo, SV 13).
- Constitucional (CF atualizada até 13/11/2026): poder constituinte, art. 5º com as teses do STF (domicílio, reunião, confisco), remédios, direitos sociais (greve de policial), nacionalidade pela EC 131/2023, direitos políticos, competências (trânsito é privativa da União), Executivo (posse em 5 de janeiro, EC 111/2021), segurança pública e estados de defesa e sítio (com a PEC 18/2025 aguardando promulgação) e ordem social.
- Trânsito cobre o CTB inteiro, conferido no texto compilado deste app (04/11/2026): SNT e competências da PRF, circulação (velocidades, tempo de direção), pedestres, sinalização, veículos, escolares e motofrete, habilitação, infrações, penalidades (20/30/40 pontos), medidas administrativas, processo, crimes de trânsito e a Lei 5.970/1973. Inclui as resoluções do CONTRAN em vigor (pesos e dimensões 882/2021, videomonitoramento 909/2022, tacógrafo 938/2022, amarração 945/2022, vidros 960/2022, placas 969/2022, radares 798/2020 e passageiros em veículo de carga 508/2014). Use **Treinar por matéria**; a etiqueta mostra o tópico (ex.: "Prisão em flagrante e audiência de custódia").
- Não são questões de prova (essas estão no banco PRF 2021) e não entram em Simulados da planilha.
- O arquivo `bancos/socrates-trilhas-prf.json` é gerado pelo Sócrates (`python -m socrates.estudo.exportar_app CAMINHO_DO_APP`). O número de cada item não muda entre versões, então o progresso e os cartões continuam valendo; item novo entra no fim. O Sócrates não baixa este banco de volta (já tem os itens nas trilhas).

## Questões de prova com lei que mudou depois (13/11/2026)
- Quando a lei muda depois da prova, a questão ganha `atual` (o gabarito de hoje) e `atualizacao` (o porquê). No **treino** e nos **cartões** vale o gabarito de hoje, com o aviso "⚖ A lei mudou depois da prova" mostrando o oficial; no **simulado** continua valendo o oficial, para a nota ser comparável à da prova.
- PRF 2021, item 82: o gabarito oficial foi Errado (a tolerância por eixo era 10%), mas a Lei 14.229/2021 subiu para 12,5% (Lei 7.408/1985, art. 1º, II; Resolução CONTRAN 882/2021, art. 50). Hoje o item é Certo.
- Os outros 13 itens de resoluções do CONTRAN da PRF 2021 foram conferidos nas resoluções em vigor e continuam com o gabarito oficial.

## Resumos do Sócrates (13/11/2026)
- **Hoje → 📚 Resumos** (ou o botão "Ler os resumos dos tópicos" no card do Sócrates, em Questões): a teoria de cada tópico do edital, por matéria e na ordem do que mais cai (★ a ★★★). São 137 tópicos em 14 matérias (todas as do edital; Língua Estrangeira só em Inglês).
- Cada tópico traz **pontos-chave** (com o artigo), **pegadinhas da banca** e **o que mudou na lei**, conferidos nas fontes oficiais até 13/11/2026.
- **🎯 Treinar** abre só os itens de fixação daquele tópico; **📝 Questões da prova deste tópico** abre as questões reais da PRF 2021 ligadas a ele.
- "Marcar como lido" fica guardado no aparelho e aparece na lista (✅) e no card da Hoje.
- O arquivo `bancos/socrates-resumos-prf.json` é gerado pelo Sócrates junto com o banco (`python -m socrates.estudo.exportar_app CAMINHO_DO_APP`) e funciona offline.


## Plano da semana (16/11/2026)
- Card **🗓 Plano de hoje** no topo da tela Hoje: matérias do dia (✅ quando você registra estudo nelas), o que fazer, tempo e "Questões hoje: X de N".
- **Ver a semana**: os 7 dias editáveis (adicionar/tirar matérias, nº de questões, tempo, o que fazer). Salvo no aparelho.
- Começa com o plano da aba Estudos da planilha. Questões: 15-20 na segunda (do próprio plano) e a meta diária de Ajustes (30) nos outros dias. Botão "Voltar ao plano da planilha" restaura.

## Trilha do edital (16/11/2026)
- Página **🧭 Trilha do edital** (card na tela Hoje): as 15 matérias do edital PRF 2021 (item 24), cada uma em ordem do mais básico ao mais difícil, com nível (Base, Médio, Difícil), o item do edital e o motivo da ordem. Marque o que já estudou; o próximo tópico fica destacado.
- O **Plano de hoje** mostra o próximo tópico da trilha para cada matéria do dia.
- Dados em `bancos/trilha-edital-prf.json` (gerado por um script fora do repositório).
- Cada tópico da trilha ligado a um resumo do Sócrates ganha os botões **📚 Resumo** e **🎯 Treinar**. "Voltar" no resumo traz de volta para a trilha.
- **Língua Portuguesa** entrou nos resumos e no banco do Sócrates (14 tópicos, 82 itens Certo/Errado), com os itens 9 a 26 da PRF 2021 ligados.

## Edital coberto: Bloco I completo (16/11/2026)
- Entraram no Sócrates e no app: **Raciocínio Lógico-Matemático** (11 tópicos, 66 itens), **Informática** (6, 36), **Física** (5, 33), **Geopolítica** (10, 60) e **Língua Inglesa** (2, 12), com os itens 27 a 55 da PRF 2021 ligados aos tópicos.
- **Conteúdo no app: 157 dos 157 tópicos da trilha (100%)**. O card da trilha na tela Hoje mostra esse número, e cada matéria mostra "N de M com conteúdo no app".
- **Ética** ganhou o Código de Conduta da Alta Administração Federal (item 4.4.3 do edital; 7 itens): quem ele alcança, presentes e brindes (com o Decreto 10.889/2021), interdição de 4 meses x quarentena de 6 meses da Lei 12.813/2013, advertência e censura ética, e o que mudou com os Decretos 10.478/2020 e 10.571/2020.
- As 103 questões do banco da PRF 2021 estão todas ligadas a um tópico dos resumos.
- O tópico do **Anexo I do CTB** (conceitos e definições) abre direto a leitura da lei (**📖 Ler no CTB do app**).
- Raciocínio Lógico ganhou um passo extra de lógica proposicional (não está no edital de 2021, mas a banca cobra em outros concursos policiais).
- Geopolítica usa os dados do IBGE (Censo 2022, estimativa de 2025, REGIC 2018, biomas) e as mudanças recentes (acordo Mercosul–União Europeia, Lei 15.190/2025 do licenciamento ambiental).
- Cobertura quer dizer que o tópico tem resumo e itens de fixação (ou a lei) dentro do app. É resumo: não substitui a leitura da lei seca das leis especiais nem das resoluções do CONTRAN, que entram só com o que mais cai.

## Resoluções do CONTRAN aprofundadas (17/11/2026)
- Na trilha de Legislação de Trânsito, o passo único de resoluções virou 6 passos: as mais cobradas; álcool e drogas (Res. 1.031/2026, que substituiu a 432/2013); tempo de direção (525/2015); capacete (940/2022); habilitação (1.020/2025: autoescola facultativa, instrutor autônomo, estrangeiro 180 dias); e "o que vale hoje", com o mapa das 34 resoluções do edital retificado e as que as substituíram, AET, tolerância dos radares e distância da placa R-19.
- 28 itens novos no banco do Sócrates (Legislação de Trânsito: 104).

## Macetes e Desempenho (17/11/2026)
- **🧠 Macetes** (card na tela Hoje): 20 mnemônicos conferidos com a lei (SOCIDIVAPLU, CONGAERRPRO, LIMPE, FASE, COFIFOMOB, PATI, CAPACETE DE PM, PUFET, MP3.COM, LEED, NIM, MANÉ, pontos 7-5-4-3 e 20-30-40, velocidades do art. 61 etc.). Cada um mostra as partes, a pegadinha que ele evita e a fonte, abre o resumo do tópico e tem 2 itens de "lista trocada" (banco **Macetes · PRF**, 40 itens). O macete também aparece dentro do resumo do tópico. Para editar: `ferramentas/macetes.py` (regera `bancos/macetes-prf.json`).
- **📊 Desempenho** (card na tela Hoje): questões respondidas e % de acerto por Hoje, Semana, Mês, 7 dias, 30 dias ou Tudo, com comparação com o período anterior; por matéria (da pior para a melhor, com variação); matéria mais forte e a que precisa de atenção; certeza × resultado (erros com certeza e acertos no chute); meta de questões do plano; nota líquida estilo Cebraspe; gráfico dos últimos 14 dias ou 8 semanas; últimos simulados. Tocar numa matéria abre o treino das erradas dela.
- Dá para registrar questões feitas fora do app (Gran, QConcursos, livro): entram nas contas e vão para a planilha.
- A partir desta versão cada resposta guarda matéria, banco e certeza no histórico do aparelho; as respostas anteriores aparecem como "Sem matéria".

