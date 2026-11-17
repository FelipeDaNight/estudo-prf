# Gera bancos/macetes-prf.json: macetes conferidos com o texto da lei (ou marcados como doutrina),
# cada um ligado a um resumo do Sócrates e com itens Certo/Errado de "lista trocada".
import json, re, os
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = BASE + "/bancos/macetes-prf.json"
M = []
def mac(id, materia, res, nome, sigla, partes, fonte, pegadinha, itens, extra=""):
    assert {r for _, r, _ in itens} == {"C", "E"}, id
    M.append({"id": id, "materia": materia, "res": res, "nome": nome, "sigla": sigla,
              "partes": [{"l": l, "t": t} for l, t in partes], "fonte": fonte, "pegadinha": pegadinha, "extra": extra,
              "itens": [{"t": t, "r": r, "j": j} for t, r, j in itens]})

CF = "Direito Constitucional"
mac("socidivaplu", CF, "", "Fundamentos da República", "SOCIDIVAPLU",
    [("SO", "soberania"), ("CI", "cidadania"), ("DI", "dignidade da pessoa humana"), ("VA", "valores sociais do trabalho e da livre iniciativa"), ("PLU", "pluralismo político")],
    "CF, art. 1º, I a V", "Fundamento é substantivo (soberania, cidadania...). Se a frase começa com verbo (construir, garantir, erradicar, promover), é OBJETIVO do art. 3º.",
    [("O pluralismo político e a dignidade da pessoa humana são fundamentos da República Federativa do Brasil.", "C", "CF, art. 1º, III e V."),
     ("A erradicação da pobreza e da marginalização é um dos fundamentos da República Federativa do Brasil.", "E", "CF, art. 3º, III: é objetivo fundamental, não fundamento (art. 1º).")], extra="Princípios fundamentais (arts. 1º a 4º): fora do edital da PRF de 2021, mas cai em quase todo concurso.")
mac("congaerrpro", CF, "", "Objetivos fundamentais da República", "CONGAERRPRO",
    [("CON", "CONstruir uma sociedade livre, justa e solidária"), ("GA", "GArantir o desenvolvimento nacional"), ("ERR", "ERRadicar a pobreza e a marginalização e reduzir as desigualdades sociais e regionais"), ("PRO", "PROmover o bem de todos, sem preconceitos de origem, raça, sexo, cor, idade e quaisquer outras formas de discriminação")],
    "CF, art. 3º, I a IV", "Todo objetivo começa com VERBO. E é reduzir desigualdades, não 'erradicar' desigualdades: erradicar é a pobreza e a marginalização.",
    [("Garantir o desenvolvimento nacional é objetivo fundamental da República Federativa do Brasil.", "C", "CF, art. 3º, II."),
     ("Constitui objetivo fundamental da República erradicar as desigualdades sociais e regionais.", "E", "CF, art. 3º, III: erradicar a pobreza e a marginalização e REDUZIR as desigualdades sociais e regionais.")], extra="Princípios fundamentais (arts. 1º a 4º): fora do edital da PRF de 2021, mas cai em quase todo concurso.")
mac("ainda-nao-comprei-recopa", CF, "", "Princípios das relações internacionais", "AINDA NÃO COMPREI RECOPA",
    [("A", "Autodeterminação dos povos"), ("IN", "INdependência nacional"), ("DA", "Defesa dA paz"), ("NÃO", "NÃO-intervenção"), ("CO", "COncessão de asilo político"), ("PRE", "PREvalência dos direitos humanos"), ("I", "Igualdade entre os Estados"), ("RE", "REpúdio ao terrorismo e ao racismo"), ("CO", "COoperação entre os povos para o progresso da humanidade"), ("PA", "solução PAcífica dos conflitos")],
    "CF, art. 4º, I a X", "É asilo POLÍTICO (não 'refúgio'). E o parágrafo único fala em integração econômica, política, social e cultural dos povos da América Latina.",
    [("A concessão de asilo político é princípio que rege o Brasil em suas relações internacionais.", "C", "CF, art. 4º, X."),
     ("A soberania é princípio que rege o Brasil nas relações internacionais, previsto no art. 4º da Constituição.", "E", "CF, art. 1º, I: soberania é fundamento da República; no art. 4º está a independência nacional.")], extra="Princípios fundamentais (arts. 1º a 4º): fora do edital da PRF de 2021, mas cai em quase todo concurso.")
mac("mp3com", CF, "prf-constitucional:nacionalidade", "Cargos privativos de brasileiro nato", "MP3.COM",
    [("M", "Ministro do STF"), ("P3", "Presidente e Vice-Presidente da República, Presidente da Câmara dos Deputados e Presidente do Senado Federal"), ("C", "carreira diplomática"), ("O", "oficial das Forças Armadas"), ("M", "Ministro de Estado da Defesa")],
    "CF, art. 12, § 3º, I a VII", "Deputado, senador e ministros de Estado em geral (salvo o da Defesa) podem ser naturalizados. Só os PRESIDENTES da Câmara e do Senado precisam ser natos.",
    [("O cargo de Ministro de Estado da Defesa é privativo de brasileiro nato.", "C", "CF, art. 12, § 3º, VII."),
     ("Brasileiro naturalizado não pode exercer mandato de senador da República.", "E", "CF, art. 12, § 3º: só o cargo de Presidente do Senado Federal é privativo de nato.")])
mac("capacete-de-pm", CF, "prf-constitucional:organizacao-estado", "Competência privativa da União para legislar", "CAPACETE DE PM",
    [("C", "Civil"), ("A", "Agrário"), ("P", "Penal"), ("A", "Aeronáutico"), ("C", "Comercial"), ("E", "Eleitoral"), ("T", "do Trabalho"), ("E", "Espacial"), ("DE P", "Processual (o 'DE' é só para formar a frase)"), ("M", "Marítimo")],
    "CF, art. 22, I (e XI: trânsito e transporte)", "Trânsito e transporte também são competência PRIVATIVA da União (art. 22, XI): lei estadual ou municipal que crie regra de trânsito é inconstitucional.",
    [("Compete privativamente à União legislar sobre direito agrário, marítimo, aeronáutico e espacial.", "C", "CF, art. 22, I."),
     ("Os estados podem legislar concorrentemente com a União sobre trânsito e transporte.", "E", "CF, art. 22, XI: competência privativa da União.")])
mac("pufet", CF, "prf-constitucional:organizacao-estado", "Competência concorrente (art. 24, I)", "PUFET",
    [("P", "Penitenciário"), ("U", "Urbanístico"), ("F", "Financeiro"), ("E", "Econômico"), ("T", "Tributário")],
    "CF, art. 24, I", "Penal é privativo da União (art. 22, I); PENITENCIÁRIO é concorrente (art. 24, I). A banca troca um pelo outro.",
    [("Compete à União, aos estados e ao Distrito Federal legislar concorrentemente sobre direito penitenciário.", "C", "CF, art. 24, I."),
     ("Compete concorrentemente à União, aos estados e ao Distrito Federal legislar sobre direito penal.", "E", "CF, art. 22, I: direito penal é competência privativa da União.")])

ADM = "Direito Administrativo"
mac("limpe", ADM, "prf-administrativo:regime-juridico", "Princípios expressos da administração pública", "LIMPE",
    [("L", "Legalidade"), ("I", "Impessoalidade"), ("M", "Moralidade"), ("P", "Publicidade"), ("E", "Eficiência")],
    "CF, art. 37, caput", "Eficiência entrou pela EC 19/1998. Supremacia do interesse público, razoabilidade e proporcionalidade são princípios IMPLÍCITOS (não estão no caput do art. 37).",
    [("A eficiência é princípio expresso da administração pública no caput do art. 37 da Constituição.", "C", "CF, art. 37, caput (redação da EC 19/1998)."),
     ("A supremacia do interesse público está expressa no caput do art. 37 da Constituição.", "E", "CF, art. 37, caput: só legalidade, impessoalidade, moralidade, publicidade e eficiência; a supremacia é princípio implícito (doutrina).")])
mac("fase", ADM, "prf-administrativo:organizacao", "Administração indireta", "FASE",
    [("F", "Fundações públicas"), ("A", "Autarquias"), ("S", "Sociedades de economia mista"), ("E", "Empresas públicas")],
    "Decreto-Lei 200/1967, art. 4º, II; CF, art. 37, XIX", "Órgão (ministério, PRF, secretaria) NÃO é administração indireta: é administração direta, sem personalidade jurídica. A PRF é órgão da União.",
    [("As sociedades de economia mista integram a administração indireta.", "C", "Decreto-Lei 200/1967, art. 4º, II, c."),
     ("A Polícia Rodoviária Federal é autarquia federal integrante da administração indireta.", "E", "CF, art. 144, § 2º, e Decreto-Lei 200/1967: a PRF é órgão da administração direta da União.")])
mac("cofifomob", ADM, "prf-administrativo:ato-administrativo", "Elementos (requisitos) do ato administrativo", "COFIFOMOB",
    [("CO", "COmpetência"), ("FI", "FInalidade"), ("FO", "FOrma"), ("MO", "MOtivo"), ("OB", "OBjeto")],
    "Lei 4.717/1965 (Ação Popular), art. 2º", "Motivo e objeto formam o MÉRITO do ato discricionário. Competência, finalidade e forma são sempre vinculados.",
    [("Competência, finalidade, forma, motivo e objeto são elementos do ato administrativo.", "C", "Lei 4.717/1965, art. 2º."),
     ("No ato discricionário, a finalidade integra o mérito administrativo, ao lado do motivo.", "E", "Doutrina: o mérito está no motivo e no objeto; a finalidade é sempre vinculada.")])
mac("pati", ADM, "prf-administrativo:ato-administrativo", "Atributos do ato administrativo", "PATI",
    [("P", "Presunção de legitimidade (e de veracidade)"), ("A", "Autoexecutoriedade"), ("T", "Tipicidade"), ("I", "Imperatividade")],
    "Doutrina (Di Pietro)", "Nem todo ato tem autoexecutoriedade e imperatividade (uma licença, por exemplo, não impõe nada). A presunção de legitimidade está em todos os atos e é RELATIVA (admite prova em contrário).",
    [("A presunção de legitimidade dos atos administrativos é relativa, admitindo prova em contrário.", "C", "Doutrina: presunção juris tantum."),
     ("Todos os atos administrativos são dotados de imperatividade.", "E", "Doutrina: atos negociais e enunciativos (licença, certidão) não têm imperatividade.")])
mac("nap-4r", ADM, "prf-administrativo:agentes-publicos", "Formas de provimento (Lei 8.112)", "NAP + 4 R",
    [("N", "Nomeação"), ("A", "Aproveitamento"), ("P", "Promoção"), ("4R", "Readaptação, Reversão, Reintegração e Recondução")],
    "Lei 8.112/1990, art. 8º", "Ascensão e transferência foram REVOGADAS (Lei 9.527/1997). Nomeação é a única forma de provimento ORIGINÁRIO; as demais são derivadas.",
    [("A recondução e a reintegração são formas de provimento de cargo público previstas na Lei 8.112/1990.", "C", "Lei 8.112/1990, art. 8º, VIII e IX."),
     ("A transferência é forma de provimento de cargo público prevista na Lei 8.112/1990.", "E", "Lei 8.112/1990, art. 8º: a transferência foi revogada pela Lei 9.527/1997.")])

PEN = "Direito Penal"
mac("leed", PEN, "prf-penal:ilicitude", "Excludentes de ilicitude", "LEED",
    [("L", "Legítima defesa"), ("E", "Estado de necessidade"), ("E", "Estrito cumprimento do dever legal"), ("D", "exercício regular de Direito")],
    "CP, art. 23", "Coação moral irresistível e obediência hierárquica (art. 22) excluem a CULPABILIDADE, não a ilicitude. E o excesso, doloso ou culposo, é punido (art. 23, parágrafo único).",
    [("O estrito cumprimento do dever legal exclui a ilicitude do fato.", "C", "CP, art. 23, III."),
     ("A obediência a ordem não manifestamente ilegal de superior hierárquico é causa de exclusão da ilicitude.", "E", "CP, art. 22: exclui a culpabilidade (só o superior responde).")])
mac("ipe", PEN, "prf-penal:culpabilidade", "Elementos da culpabilidade", "I-P-E",
    [("I", "Imputabilidade"), ("P", "Potencial consciência da ilicitude"), ("E", "Exigibilidade de conduta diversa")],
    "Doutrina (teoria normativa pura); CP, arts. 21, 22 e 26 a 28", "Embriaguez voluntária ou culposa NÃO exclui a imputabilidade (CP, art. 28, II). Só a completa, por caso fortuito ou força maior, isenta de pena.",
    [("A embriaguez voluntária, ainda que completa, não exclui a imputabilidade penal.", "C", "CP, art. 28, II."),
     ("O erro de proibição evitável isenta de pena, por excluir a potencial consciência da ilicitude.", "E", "CP, art. 21: o erro inevitável isenta de pena; o evitável apenas diminui a pena de 1/6 a 1/3.")])
mac("nim", PEN, "prf-penal:fato-tipico", "Modalidades de culpa", "NIM",
    [("N", "Negligência (deixar de fazer o cuidado devido)"), ("I", "Imprudência (agir com afoiteza)"), ("M", "iMperícia (falta de aptidão técnica)")],
    "CP, art. 18, II", "Crime culposo só existe quando a lei prevê expressamente (art. 18, parágrafo único). Ex.: não há dano culposo no CP.",
    [("Diz-se o crime culposo quando o agente deu causa ao resultado por imprudência, negligência ou imperícia.", "C", "CP, art. 18, II."),
     ("Todo crime doloso admite a forma culposa, ainda que a lei não a preveja expressamente.", "E", "CP, art. 18, parágrafo único: só há punição por culpa nos casos expressos em lei.")])

PP = "Direito Processual Penal"
mac("dioesi", PP, "prf-processo-penal:diligencias", "Características do inquérito policial", "DIOSEI",
    [("D", "Dispensável"), ("I", "Inquisitivo"), ("O", "Oficioso (oficialidade)"), ("S", "Sigiloso"), ("E", "Escrito"), ("I", "Indisponível")],
    "Doutrina; CPP, arts. 9º (escrito), 17 (indisponível) e 20 (sigiloso)", "Indisponível: a AUTORIDADE POLICIAL não pode mandar arquivar o inquérito (CPP, art. 17). E o sigilo não alcança o advogado quanto aos elementos já documentados (Súmula Vinculante 14).",
    [("A autoridade policial não poderá mandar arquivar autos de inquérito.", "C", "CPP, art. 17."),
     ("O sigilo do inquérito policial impede o defensor de ter acesso aos elementos de prova já documentados.", "E", "STF, Súmula Vinculante 14: o defensor tem acesso aos elementos já documentados.")])
mac("flagrante", PP, "prf-processo-penal:prisao-flagrante", "Hipóteses de flagrante", "ESTÁ – ACABA – LOGO APÓS – LOGO DEPOIS",
    [("ESTÁ", "está cometendo a infração (flagrante próprio)"), ("ACABA", "acaba de cometê-la (flagrante próprio)"), ("LOGO APÓS", "é perseguido logo após (flagrante impróprio)"), ("LOGO DEPOIS", "é encontrado logo depois com instrumentos, armas ou objetos que façam presumir a autoria (flagrante presumido ou ficto)")],
    "CPP, art. 302, I a IV", "Perseguição = logo APÓS (impróprio); encontrado com objetos = logo DEPOIS (presumido). A banca troca as expressões.",
    [("Considera-se em flagrante quem é encontrado, logo depois, com instrumentos, armas, objetos ou papéis que façam presumir ser ele autor da infração.", "C", "CPP, art. 302, IV."),
     ("O flagrante impróprio ocorre quando o agente é encontrado, logo depois, com objetos que façam presumir a autoria.", "E", "CPP, art. 302: impróprio é a perseguição logo após (III); encontrado logo depois com objetos é o presumido (IV).")])

TR = "Legislação de Trânsito"
mac("7543", TR, "prf-transito:ctb-penalidades", "Pontos por infração e limites de suspensão", "7-5-4-3 e 20-30-40",
    [("7", "gravíssima = 7 pontos"), ("5", "grave = 5 pontos"), ("4", "média = 4 pontos"), ("3", "leve = 3 pontos"), ("20-30-40", "suspensão em 12 meses: 20 pontos com 2 ou mais gravíssimas; 30 com 1 gravíssima; 40 sem gravíssima")],
    "CTB, arts. 259 e 261, I (Lei 14.071/2020)", "Para quem exerce atividade remunerada ao volante (EAR), o limite é 40 pontos, independentemente da natureza das infrações.",
    [("Infração de natureza média computa 4 pontos no prontuário do condutor.", "C", "CTB, art. 259, III."),
     ("O condutor que somar 30 pontos em 12 meses, sem nenhuma infração gravíssima, terá o direito de dirigir suspenso.", "E", "CTB, art. 261, I, c: sem gravíssima, o limite é 40 pontos.")])
mac("velocidades", TR, "prf-transito:ctb-circulacao", "Velocidades máximas sem sinalização", "80-60-40-30 / 110-100-60",
    [("80", "via de trânsito rápido"), ("60", "via arterial"), ("40", "via coletora"), ("30", "via local"), ("110/100", "rodovia de pista dupla 110 km/h e de pista simples 100 km/h (automóveis, camionetas e motocicletas; demais veículos 90 km/h)"), ("60", "estrada (via rural não pavimentada)")],
    "CTB, art. 61, § 1º", "Na cidade a ordem é a da hierarquia das vias: trânsito rápido > arterial > coletora > local. Os 90 km/h valem para os 'demais veículos' nas rodovias, em pista dupla ou simples.",
    [("Onde não houver sinalização, a velocidade máxima em via arterial é de 60 km/h.", "C", "CTB, art. 61, § 1º, I, b."),
     ("Em rodovia de pista simples sem sinalização, a velocidade máxima para automóveis é de 110 km/h.", "E", "CTB, art. 61, § 1º, II, a, 2: 100 km/h; os 110 km/h são da pista dupla.")])

RLM = "Raciocínio Lógico-Matemático"
mac("mane", RLM, "prf-rlm:logica", "Negação da condicional", "MANÉ",
    [("MA", "MAntém a primeira"), ("N", "E (troca o 'se...então' por 'e')"), ("É", "nEga a segunda")],
    "Lógica proposicional: ~(p → q) ≡ p ∧ ~q", "A negação de 'se p, então q' NUNCA é outra condicional. Já a equivalência (contrapositiva) é 'volta negando': p → q ≡ ~q → ~p.",
    [("A negação de 'Se chove, então a pista fica molhada' é 'Chove e a pista não fica molhada'.", "C", "Lógica: ~(p → q) ≡ p ∧ ~q."),
     ("A negação de 'Se chove, então a pista fica molhada' é 'Se não chove, então a pista não fica molhada'.", "E", "Lógica: a negação de uma condicional é uma conjunção (p ∧ ~q), não outra condicional.")])

PT = "Língua Portuguesa"
mac("crase-volta", PT, "prf-portugues:crase", "Crase com nome de lugar", "VOU A, VOLTO DA: CRASE HÁ",
    [("DA", "vou à Bahia, porque volto DA Bahia: tem crase"), ("DE", "vou a Goiânia, porque volto DE Goiânia: não tem crase ('vou a, volto de, crase pra quê?')")],
    "Gramática normativa (crase = preposição a + artigo a)", "Com lugar especificado volta o artigo: 'vou à Goiânia dos anos 60'. E nunca há crase antes de palavra masculina (salvo 'à moda de' implícito).",
    [("Em 'Viajou à Bahia nas férias', o acento grave está correto.", "C", "Gramática: volto da Bahia, logo há artigo e a crase é obrigatória."),
     ("Em 'Chegou à Goiânia ontem à noite', o primeiro acento grave está correto.", "E", "Gramática: volto de Goiânia, logo não há artigo e não há crase (o segundo, 'à noite', está correto).")])

assert len({m["id"] for m in M}) == len(M)
banco = {"id": "macetes-prf", "titulo": "Macetes · PRF", "banca": "Cebraspe (estilo)", "ano": 2026, "tipo": "ce",
         "sincroniza_simulado": False, "origem": "macetes",
         "aviso": "Macetes conferidos com o texto da lei (ou marcados como doutrina) em 17/11/2026. Cada item testa a 'lista trocada', a pegadinha preferida da Cebraspe.",
         "macetes": M, "questoes": []}
n = 0
for m in M:
    for it in m["itens"]:
        n += 1
        banco["questoes"].append({"n": n, "ref": "macete:" + m["id"], "materia": m["materia"], "topico": "Macete " + m["sigla"] + " · " + m["nome"],
                                  "tipo": "ce", "resp": it["r"], "enunciado": it["t"], "just": it["j"]})
json.dump(banco, open(OUT, "w"), ensure_ascii=False, indent=1)
idx = json.load(open(BASE + "/bancos/index.json"))
idx = [x for x in idx if x["id"] != "macetes-prf"] + [{"id": "macetes-prf", "arquivo": "bancos/macetes-prf.json", "titulo": banco["titulo"], "n": n, "origem": "macetes"}]
json.dump(idx, open(BASE + "/bancos/index.json", "w"), ensure_ascii=False, indent=1)
print(len(M), "macetes,", n, "itens")
