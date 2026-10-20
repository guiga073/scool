# Olimais — Sistema de Gestão

Sistema interno de gestão para o seu reforço escolar: cadastro de alunos e professores,
um controle de interessados (os pais que pediram informações e ainda não agendaram aula),
um banco de talentos com os potenciais professores que você quer guardar para o futuro,
agendamento de aulas com calendário, materiais de aula compartilhados entre professores
e alunos, confirmação das aulas pelo WhatsApp Business, e controle de pagamentos (a receber dos alunos e a pagar aos professores,
quinzenalmente).

Este documento explica como testar o sistema no seu computador e, principalmente,
**como colocá-lo no ar** para você e sua equipe usarem de verdade.

---

## 1. Como o sistema foi construído (leia antes de publicar)

Para que a instalação seja simples e confiável, este sistema foi construído **sem
depender de nenhum pacote externo** (nada de `npm install` baixando dezenas de
bibliotecas que podem quebrar). Ele usa só os recursos nativos do Node.js 22+:

- Um servidor HTTP simples (`node:http`)
- Um banco de dados SQLite embutido no próprio Node (`node:sqlite`) — os dados ficam
  salvos em um único arquivo (`data/sistema.db`)
- Autenticação por sessão com hash de senha (`node:crypto`)

Isso significa: **não existe um passo de "build" que possa falhar**, e não há
dependências para ficarem desatualizadas ou vulneráveis com o tempo. O único requisito
é rodar em **Node.js versão 22.5 ou mais recente**.

O ponto de atenção correspondente: o `node:sqlite` é um recurso relativamente novo do
Node (ainda em amadurecimento, embora já estável o suficiente para uso). Para uma
ferramenta interna de uma escola, isso é uma troca segura em favor de uma instalação
muito mais simples. Se no futuro você quiser migrar para PostgreSQL/MySQL por qualquer
motivo, toda a lógica do banco está isolada em `server/db.js` e `server/services.js`.

---

## 2. Testar no seu computador (opcional, mas recomendado)

1. Instale o [Node.js](https://nodejs.org) versão 22 ou mais recente.
2. Copie o arquivo `.env.example` para `.env` e preencha `ADMIN_EMAIL` e `ADMIN_PASSWORD`
   com o que você quiser usar para o primeiro acesso.
3. Na pasta do projeto, rode:
   ```
   npm install
   npm start
   ```
   (o `npm install` não vai instalar nada, pois não há dependências — é só por
   hábito/segurança.)
4. Abra `http://localhost:3000` no navegador e entre com o e-mail/senha do `.env`.

---

## 3. Colocar no ar (recomendado: Railway)

A Railway é um serviço de hospedagem que roda seu servidor Node.js continuamente (ao
contrário de serviços "serverless" como a Vercel, que não são adequados aqui porque
precisamos manter o arquivo do banco de dados salvo entre as requisições). Ela tem um
período de teste gratuito e depois um plano pago simples (na casa de US$5/mês para um
uso pequeno como este).

### Passo a passo

**a) Suba o código para o GitHub**
1. Crie uma conta em [github.com](https://github.com) se ainda não tiver.
2. Crie um repositório novo (pode ser privado) e envie esta pasta do projeto para ele.
   Se você nunca fez isso, o próprio GitHub mostra o passo a passo ao criar o
   repositório ("…or push an existing repository from the command line").

**b) Crie o projeto na Railway**
1. Acesse [railway.com](https://railway.com) e crie uma conta (dá para entrar direto
   com o GitHub).
2. Clique em **New Project → Deploy from GitHub repo** e escolha o repositório que
   você acabou de criar.
3. A Railway detecta sozinha que é um projeto Node.js e já tenta subir. Ainda falta
   configurar duas coisas importantes (próximos passos) antes de usar de verdade.

**c) Configure as variáveis de ambiente**
1. Dentro do projeto na Railway, abra o serviço → aba **Variables**.
2. Adicione:
   - `ADMIN_EMAIL` — o e-mail que você vai usar para entrar no sistema
   - `ADMIN_PASSWORD` — uma senha forte
   - `TZ` — `America/Sao_Paulo` (ou o fuso da sua região, se for diferente)
   - `DATA_DIR` — `/data` (vai bater com o volume que criaremos a seguir)

**d) Adicione um Volume (armazenamento permanente)**
Sem isso, o banco de dados seria apagado a cada nova versão publicada — é o passo mais
importante e mais fácil de esquecer.
1. No painel do projeto, clique com o botão direito na área do serviço (ou use o atalho
   `Cmd/Ctrl+K` → "Volume").
2. Crie um volume e monte-o no caminho `/data` (o mesmo valor que você colocou em
   `DATA_DIR`).
3. A Railway reinicia o serviço automaticamente depois de anexar o volume.

O volume guarda **o banco de dados e também os arquivos dos Materiais de aula** (veja a
seção 6). No plano Hobby o volume vai até **5 GB**; o teto que o portal usa para os
materiais é **4,5 GB**, o que deixa folga para o banco de dados.

**Como isso se comporta quando você dá um novo `git push`:** o Volume é um disco à
parte, ligado ao *serviço*, não a uma versão específica do código. Quando você sobe um
commit novo, a Railway constrói um container novo com o código atualizado, liga esse
container novo já com o **mesmo** Volume montado em `/data`, e só depois desliga o
container antigo — o arquivo `sistema.db` nunca é recriado nem tocado por esse processo,
então os dados de quem já estava usando o sistema continuam lá. Isso é o comportamento
oficial e documentado da Railway, e é exatamente por isso que o passo do Volume importa
tanto: sem ele, cada novo commit realmente apagaria tudo, porque o container roda em um
disco temporário por padrão.

Duas coisas para não deixar passar:
- **Confirme que o Volume existe de verdade**: na aba do serviço na Railway, você deve
  ver o Volume listado (nome, tamanho usado) — se não aparecer nada ali, ele não foi
  criado corretamente e os dados não vão persistir.
- **Teste uma vez, na prática**: depois de configurar tudo, cadastre um aluno de teste,
  dê um `git push` de qualquer mudança pequena (ou clique em "Redeploy" no painel), e
  confira se o aluno de teste continua lá depois. Isso confirma que está tudo certo para
  o seu caso específico — plataformas de nuvem, de vez em quando, têm casos isolados
  onde isso não funciona como esperado (geralmente por permissão de arquivo), então vale
  mais confiar numa checagem real do que só na teoria. Se o servidor cair logo depois de
  subir com algum erro de permissão negada ao gravar em `/data`, adicione a variável de
  ambiente `RAILWAY_RUN_UID=0` no serviço — isso resolve um problema conhecido de
  permissão entre o Volume (que monta como usuário root) e imagens que rodam com outro
  usuário.
- **Sobre backup**: o volume por si só não é um backup — é só onde os dados vivem
  normalmente. Depois de publicar, veja a seção **"Backup — como funciona e o que eu
  recomendo"** mais abaixo neste documento: o backup automático da Railway existe, mas
  só no plano Pro; incluí no próprio sistema uma forma de backup que funciona em
  qualquer plano, sem custo extra.

**e) Gere o endereço público**
1. Na aba **Settings** do serviço, em **Networking**, clique em **Generate Domain**.
2. Você vai receber um endereço do tipo `seu-projeto.up.railway.app` — é esse o link
   que você vai usar (e pode compartilhar com quem mais precisar acessar).
3. Se sua escola já tem um domínio próprio (ex.: `sistema.suaescola.com.br`), essa
   mesma tela permite apontar um **Custom Domain**.

**f) Primeiro acesso**
Abra o endereço gerado, entre com o `ADMIN_EMAIL`/`ADMIN_PASSWORD` que você configurou,
e comece a cadastrar alunos e professores.

> Sempre que você alterar o código e enviar (`git push`) para o GitHub, a Railway
> publica a nova versão sozinha, sem apagar os dados salvos no volume.

### Alternativa: Render

O [Render](https://render.com) funciona de forma parecida (conectar o GitHub, definir
variáveis de ambiente, adicionar um "Persistent Disk" com um caminho de montagem, que
você também apontaria com `DATA_DIR`). O plano gratuito do Render "dorme" o serviço
depois de um tempo sem uso, o que atrasa a primeira resposta depois de um período
parado — para um sistema usado várias vezes ao dia isso tende a incomodar, então vale
considerar o plano pago caso note lentidão.

---

## 4. Depois de publicado

- **Guarde a URL** em um lugar de fácil acesso para você e sua equipe (favoritos do
  navegador, por exemplo).
- **Faça login** com o e-mail/senha definidos nas variáveis de ambiente.

### Fuso horário

O sistema roda sempre em **America/Sao_Paulo** (o mesmo fuso do Rio de Janeiro — no
Brasil, essas duas cidades e a maior parte do país compartilham o mesmo horário). Isso
é fixado diretamente no código, não depende de nenhuma configuração do servidor de
hospedagem, então não tem como um provedor sobrepor isso sem querer. Vale para tudo que
o sistema registra como "agora" — hora de marcar um pagamento como feito, hora de
cancelar uma aula, etc. — mas **não muda o horário de aulas que você mesmo cadastrou**:
esses horários continuam exatamente como você digitou, já que são apenas texto
guardado, sem nenhuma conversão de fuso por trás.

### O que significa cada data no Histórico

Cada categoria do Histórico mostra duas datas, com nomes diferentes dependendo da
categoria:
- Uma coluna com a **data "de referência"** daquele registro (nomeada "Data da aula",
  "Início da quinzena" ou "Vencimento", dependendo da categoria) — é sobre o que a
  cobrança trata, não quando ela foi paga.
- A coluna **"Pago/recebido em"** — é quando você de fato marcou aquilo como pago ou
  recebido no sistema, com hora exata. É essa data que decide em qual mês o valor entra
  no painel Financeiro.

### Backup — como funciona e o que eu recomendo

Existem duas camadas possíveis de backup. Vale usar as duas, mas a segunda é a que
realmente importa e funciona em qualquer plano.

**1) Backup nativo da Railway (opcional, só no plano Pro)** — a Railway tem uma aba
**Backups** no serviço, com agendamento diário/semanal/mensal e restauração pelo
próprio painel. **Atenção**: essa função só existe no plano **Pro** (a partir de
US$20/mês); no plano **Hobby** (US$5/mês, o que a maioria usa para começar) essa aba
aparece mas não deixa criar nenhum backup. Se você estiver no Hobby e quiser essa
camada a mais, precisaria migrar para o Pro — não é obrigatório, por causa do item
abaixo.

**2) Backup de dentro do próprio sistema (recomendado, funciona em qualquer plano,
sem custo extra)** — adicionei um botão **"Baixar backup dos dados"** no rodapé do
menu lateral, visível em qualquer tela depois de logado como administrador. Ele baixa
uma cópia completa e íntegra do banco de dados (um arquivo `.db`) na hora, puxando os
dados mais recentes mesmo que tenham acabado de ser salvos. Essa cópia fica **fora da
Railway por completo** — no seu computador, o que por si só já é uma proteção
melhor do que depender só do backup automático de um provedor: se algum dia houver um
problema com a própria Railway (conta, cobrança, bug da plataforma), você ainda tem os
dados em mãos, independente dela.

**Atenção — os arquivos dos Materiais não entram em nenhum desses dois backups.** O botão
"Baixar backup dos dados" salva só o banco (que inclui a *lista* de materiais, mas não os
arquivos em si), e o backup de volume da Railway não existe no plano Hobby. O que fazer a
respeito está na seção 6, em "Backup dos arquivos". Já os **currículos do Banco de talentos**
ficam dentro do próprio banco de dados, então **entram** no "Baixar backup dos dados" (o
arquivo de backup fica um pouco maior por causa deles — veja a seção 7). Os cadastros do
**Controle de interessados** também ficam no banco e entram no backup (seção 8).

**Minha recomendação prática**: uma vez por semana (ou depois de um dia de muito
cadastro novo), clique em "Baixar backup dos dados" e salve o arquivo num lugar
seguro — Google Drive, e-mail para você mesmo, um pendrive, tanto faz. Se um dia
precisar restaurar, me avise: dá para eu adicionar também uma tela de restauração
dentro do próprio sistema (não fiz isso agora de cara porque é uma operação que
substitui todos os dados atuais pelos do arquivo escolhido, e preferi confirmar com
você antes de colocar algo assim no ar). Enquanto isso, a restauração manual é
possível por um terminal (Shell) no painel da Railway, substituindo o arquivo
`data/sistema.db` pelo seu backup e reiniciando o serviço.

---

## 5. Um tour rápido pelas funcionalidades

- **Alunos** — cadastro completo (nome, série, endereço, responsáveis, telefone). A caixa
  "Pagamento mensal" faz o aluno aparecer em **Pagamentos → Pagamentos mensais** em
  vez de na lista de cobrança aula a aula — as aulas dele continuam no calendário
  normalmente. A mensalidade **não** é um valor digitado: é sempre o **total das aulas do
  aluno naquele mês somadas** (o "valor que o aluno paga" de cada aula, definido no
  agendamento). Assim como o professor, cada aluno
  também pode ter um **login próprio** (e-mail + senha, preenchidos por você no
  cadastro): com ele, o aluno entra pelo mesmo endereço do site e cai numa área só dele
  (`/aluno.html`), com três abas — "Minhas aulas" (a própria agenda: dia, horário,
  disciplina, professor, e o link quando a aula é online), "Materiais" (os arquivos e links
  que os professores compartilharam com ele, e onde ele também pode enviar — veja a seção
  6) e "Feedbacks" (tudo que os professores já escreveram sobre ele, de forma só de
  leitura — quem escreve é sempre o professor). No alto da tela, em qualquer aba, fica o
  botão **"Manual do aluno"**, que abre o guia em PDF de como usar a área (veja "Manual da
  Área do Aluno (PDF)", mais abaixo). Na ficha do aluno: dados, calendário de
  aulas, notas, observações e materiais.

  **Série do aluno**: campo opcional logo abaixo do nome, no cadastro (ex.: "6º ano",
  "2ª série EM"). É um texto livre de até 40 caracteres: o campo sugere as opções mais
  comuns (Educação Infantil, 1º ao 9º ano, 1ª a 3ª série EM, Pré-vestibular e Ensino
  superior), mas dá para digitar qualquer outra coisa. Aparece na lista de Alunos (coluna
  "Série") e no topo de "Dados cadastrais" da ficha. Quem já estava cadastrado fica com
  "—" até você preencher (Alunos → abrir o aluno → Editar). A série **não** muda sozinha
  na virada do ano: quando o aluno mudar de série, é só editar o cadastro. A busca da
  lista continua sendo só por nome, e apenas a secretaria vê e altera a série (ela não
  aparece nas áreas de professores e alunos). No banco de dados, a série é a coluna
  `grade_level` da tabela `students` (a tabela `grades` guarda as **notas**, não a série).

  **Gerar login para todos os alunos de uma vez**: na lista de Alunos, o botão
  **"Gerar usuários e senhas para todos"** cria, para cada aluno cadastrado, um usuário
  (primeiro nome + sobrenome, sem espaço/acento — ex.: "joaosilva"; se já existir
  alguém com esse mesmo usuário, seja aluno, professor ou admin, entra um número no
  final automaticamente) e uma senha de 5 caracteres, e baixa uma planilha CSV com
  tudo. Mesma regra de segurança do botão equivalente de Professores: a senha só
  aparece em texto nesse momento — depois disso, não tem como ver de novo. O campo de
  login (tanto de aluno quanto de professor) aceita usuário simples ou e-mail de
  verdade, e a tela de login também — não precisa ser um e-mail.

  **Excluir aluno ou professor**: o histórico de aulas e pagamentos dele é preservado
  (por isso ele some das listas em vez de ser apagado do banco), mas o **login é
  liberado** — usuário/e-mail e senha deixam de existir, e você pode cadastrar outra
  pessoa com o mesmo usuário ou e-mail sem problema.
- **Interessados** — página própria no menu (logo abaixo de Alunos), **só para a administração**:
  o controle dos pais e responsáveis que entram em contato, perguntam sobre as aulas e ainda não
  agendam nada, para você retomar a conversa mais tarde. Cada interessado guarda o nome do
  responsável, telefone/WhatsApp, e-mail, nome e série do aluno, disciplinas e modalidade de
  interesse, como conheceu a Olimais, a **situação** (Novo, Em conversa, Retornar depois, Virou
  aluno ou Sem interesse), a data do primeiro contato, uma **data de retorno** e as suas
  **observações**. Só o nome é obrigatório. A lista tem busca (nome, telefone, aluno,
  observações, disciplina…) e filtros por situação e por disciplina, e avisa **Hoje** ou
  **Atrasado** quando chega a data de retorno de um caso em aberto; a ficha deixa trocar a
  situação e editar as observações na hora. Professores e alunos não veem nada disso. Campos,
  backup e cuidados com os dados pessoais: seção 8.
- **Professores** — cadastro com disciplinas e PIX. Na lista você procura **por nome ou
  por disciplina**: digite na caixa de busca (ela acha o nome e também a disciplina, sem
  se importar com acento ou maiúscula — "matematica" acha quem dá Matemática) e/ou
  escolha uma disciplina na caixa **"Todas as disciplinas"**, ao lado. As duas funcionam
  juntas e, quando há filtro, a lista mostra quantos professores foram encontrados. Tem
  também dois campos de **valor por hora** (presencial e online) e um de **transporte**,
  todos visíveis **só para você** — o professor não vê esses valores, nem pela própria
  área dele (só vê o total certo que vai receber, já com tudo somado). O valor/hora
  serve para preencher sozinho o campo "valor pago ao professor" ao agendar uma aula:
  assim que você escolhe o professor, a modalidade e o horário, o sistema calcula
  valor/hora × duração e já sugere o valor — sempre editável depois, caso você queira
  cobrar diferente numa aula específica. O transporte é um valor **fixo por aula
  presencial**, que não depende da duração (nasce com R$10, o mesmo valor já foi
  preenchido automaticamente em todos os professores que você já tinha cadastrado
  antes desta atualização) — ele só aparece no formulário quando a aula é presencial, e
  entra somado automaticamente no total que o professor recebe naquela quinzena. Ao
  lado do campo de professor, no agendamento, aparece o valor/hora cadastrado dele,
  para consulta rápida. Também é possível dar a cada
  professor um **login próprio** (e-mail + senha, preenchidos por você no cadastro):
  com ele, o professor entra pelo mesmo endereço do site e cai numa área só dele
  (`/professor.html`), onde vê o valor a receber na quinzena atual (que atualiza sozinho
  conforme você agenda aulas para ele), o histórico de faturas, as próprias aulas
  marcadas, preenche a própria disponibilidade, compartilha **materiais** de aula com cada aluno
  dele (aba "Materiais") e registra **feedback de aula** para
  cada aluno que ele dá aula (aba "Alunos" → escolhe o aluno → "Adicionar feedback",
  preenchendo data e o texto). Um botão "Ver como texto" reúne todo o histórico de
  feedback daquele aluno num bloco de texto simples (Data / Feedback, um embaixo do
  outro) pronto para copiar e mandar para o responsável, por exemplo. Você, pela ficha
  do professor (aba "Alunos e feedback"), vê e também pode lançar esse mesmo feedback
  em nome dele.

  **Sobre ver/exportar as senhas dos professores**: o sistema guarda a senha como um
  hash (criptografia de mão única) — ninguém, nem eu, consegue "abrir" uma senha já
  definida e ver o texto original; só é possível redefinir uma nova. Por isso, toda vez
  que você define ou troca a senha de um professor (seja no cadastro individual, seja
  em massa), aparece uma janela mostrando essa senha em texto — é a única vez que ela
  vai aparecer, então copie ou baixe ali mesmo. Na lista de Professores, o botão
  **"Gerar novas senhas e baixar planilha"** faz isso para todos os professores com
  login ativo de uma vez, trocando a senha atual de cada um (senhas de 5 caracteres,
  só letras e números) e baixando um CSV (nome, e-mail, senha nova) para você
  compartilhar com cada um. Senha de 5 caracteres é mais fácil de digitar/ditar, mas
  também mais fraca do que uma mais longa — se quiser aumentar o tamanho no futuro, é
  só pedir.

  A disponibilidade é uma grade de Segunda a Domingo, das 8h às 20h — o
  professor (ou você, pelo cadastro dele) marca os horários livres clicando nos
  quadradinhos. Isso é só uma anotação; como pedido, não bloqueia nem avisa nada no
  agendamento. Na ficha do professor (lado da secretaria): dados, alunos e feedback,
  disponibilidade, calendário de aulas e o total de horas/valor de cada quinzena.
- **Banco de talentos** — página própria no menu, **só para a administração**: o lugar para
  guardar os potenciais professores que você talvez queira contratar no futuro. Cada talento
  tem praticamente os mesmos dados de um professor — nome, telefone, e-mail, endereço,
  disciplinas que poderia lecionar, valor por hora que pretende receber (presencial e online)
  e disponibilidade —, mais o **currículo** (um arquivo anexado) e um campo de
  **observações** para as suas anotações (como conheceu a pessoa, impressões da entrevista…).
  Login, senha, PIX e transporte ficam de fora, porque só fazem sentido quando a pessoa é
  contratada. A lista tem busca (nome, disciplina, contato, observações) e filtro por
  disciplina; a ficha mostra tudo, abre ou baixa o currículo e deixa editar as observações na
  hora. Professores e alunos não veem nada disso. Limites, tipos de arquivo, backup e cuidados
  com os dados pessoais: seção 7.
- **Feedbacks** — uma aba própria no menu, só para a secretaria, para consultar o
  feedback já registrado sem precisar entrar na ficha de cada professor. Alterna entre
  "Por aluno" (busca um aluno e vê o feedback de todos os professores dele, cada item
  já indicando qual professor escreveu) e "Por professor" (busca um professor e vê o
  feedback que ele deu para todos os alunos dele). Tem o mesmo botão "Ver como texto" e
  a opção de excluir um item, se precisar.
- **Materiais** — página própria no menu, onde você vê tudo que professores e alunos
  compartilharam (listas de exercícios, fotos de caderno, slides, links de vídeo), quanto do
  espaço já foi usado, e apaga o que não for mais necessário. Também tem a chave que liga
  ou desliga o envio pelos alunos. Os professores enviam pela área deles (aba "Materiais" →
  escolhe o aluno) e os alunos pela área deles. Limites, tipos aceitos, permissões e
  backup: seção 6.
- **Financeiro** — visão geral do negócio: receita, custos e lucro do mês escolhido, um
  gráfico comparando 6 ou 12 meses, e dois rankings do mês — faturamento por
  disciplina e custo por professor, para ver o que está puxando o resultado. **Tudo
  aqui é por regime de caixa**: cada valor conta no mês em que o dinheiro de fato
  **entrou ou saiu** (a data em que foi marcado como pago/recebido), não no mês da aula
  ou do vencimento da despesa. Isso é proposital — é o que garante que receita e custo
  usem a mesma régua e o lucro sempre bata com o que realmente aconteceu, e evita o
  problema de uma despesa com vencimento no fim do mês ficar "escondida" mesmo já tendo
  sido paga antes disso. O que ainda está pendente (aulas não pagas, faturas de
  professor em aberto, despesas a vencer) não entra no Financeiro — isso já é coberto
  pela aba Pagamentos, que é sobre o que falta receber/pagar, não sobre o que já
  aconteceu de fato.

  **Escolher o mês (passado ou futuro)**: no topo da tela há um seletor com as setas ← e →, os campos de
  mês e ano (de 5 anos atrás até 3 anos à frente) e o botão **Mês atual**; um selo diz se o mês visto é atual,
  passado ou futuro. Tudo na tela acompanha o mês escolhido, e ele fica guardado enquanto o painel estiver
  aberto (sair para Pagamentos e voltar mantém o mesmo mês). Em um **mês passado**, os cartões mostram o que
  foi de fato pago/recebido naquele mês, e o card ao lado vira "Agenda de [mês]" (o que estava agendado, tenha
  sido pago ou não, para comparar). Em um **mês futuro** nada foi pago ainda, então o bloco de realizado vira um
  aviso e a tela mostra a **Previsão** pela agenda, **inclusive as despesas recorrentes** (as contas fixas só
  ganham uma despesa de verdade quando o mês chega, então para o futuro entram como previstas, sem contar em
  dobro quando a despesa daquele mês já existir) e o detalhamento **previsto** por disciplina e por professor.
  O gráfico destaca o mês escolhido, os meses futuros aparecem como barras **tracejadas** (previsão) e dá para
  **clicar em um mês do gráfico** para ir até ele. As rotas `GET /api/finance/forecast`, `/breakdown` aceitam
  `?year=AAAA&month=M` e `/monthly` aceita `?end=AAAA-MM` (sem eles, o mês atual, como antes).

  **Previsão do mês**: logo abaixo dos números realizados, o card "Previsão de
  [nome do mês]" projeta como o mês em andamento deve fechar **se tudo que está agendado
  acontecer e for pago**. Ele é a única parte do Financeiro que não é por regime de
  caixa, de propósito: soma o valor que o aluno paga em **todas as aulas agendadas no
  mês** (as que já aconteceram e as que ainda vão acontecer) mais as mensalidades,
  desconta o que é pago aos professores por essas mesmas aulas (incluindo transporte)
  e as despesas do mês (as que vencem no mês, pagas ou não, mais as já pagas no mês),
  e mostra receita, custos, lucro e margem previstos. Aulas canceladas e aulas de
  outros meses ficam de fora. Para alunos de pagamento mensal, a previsão soma o valor
  de cada aula do mês (que é a própria mensalidade); se alguma aula deles estiver com
  valor R$ 0,00, aparece um aviso — a previsão fica menor do que será até você ajustar
  o valor dessas aulas na agenda.
- **Agendamento** — ao marcar uma aula você escolhe aluno → modalidade → disciplina →
  professor (a lista de professores já vem filtrada pela disciplina escolhida) → data e
  horário → valores → link da aula. Quando a modalidade é **presencial**, o formulário e
  a agenda mostram o **endereço cadastrado do aluno** em vez do link — é para lá que o
  professor precisa ir. Aulas **online** continuam mostrando só o link, sem endereço. Há
  também a opção de **aula recorrente semanal ("acompanhamento")**, para quem tem aula
  toda semana e você não quer agendar uma por uma: em **Agendamento → "+ Agendar
  aula"**, marque **"Aula de acompanhamento (repetir semanalmente)"**, escolha o dia
  da semana, o horário, e o período (De / Até) — o sistema cria uma aula para cada
  semana nesse período, já com os valores preenchidos. Cada aula da série fica
  registrada separadamente, então dá para editar ou cancelar uma só sem afetar as
  outras. Se o aluno vem em mais de um dia da semana, repita o processo uma vez para
  cada dia. Conflitos de horário **avisam** ("⚠️ Foram
  identificados conflitos.") mas nunca bloqueiam o agendamento. Aulas canceladas somem
  de todos os cálculos e telas.
  **Link da aula sempre com `https://`:** se você digitar ou colar o link sem o `https://` (por exemplo,
  `meet.google.com/abc-defg-hij`), o portal completa sozinho para `https://meet.google.com/abc-defg-hij` ao
  sair do campo, e também confere de novo ao salvar. Se o texto não for um endereço da internet (por
  exemplo `javascript:...`, com espaços ou sem domínio), ele avisa o motivo e não salva. Isso vale para aula
  avulsa, recorrente e edição. Aulas antigas salvas sem `https://` são corrigidas automaticamente na
  primeira vez que o servidor reinicia (aparece no log: "Links de aula corrigidos para https://").
  Na ficha da aula (Agendamento, portal do professor e portal do aluno), o link aparece **escrito por extenso**:
  o próprio endereço, clicável, que abre em outra aba. Endereços compridos (Zoom, Teams) quebram a linha em
  pontos naturais (depois de `/`, `?`, `&`, `=`) em vez de estourar a caixa.
- **Pagamentos** — cinco abas: "Pagamentos avulsos", "Pagamentos mensais", "A pagar
  (professores)", "Despesas" e "Histórico". Nada pendente desaparece sozinho — só some
  da lista de pendentes quando você marca como recebido/pago.
  - **Busca por nome e "Desfazer" (em todas as abas de lista).** No topo de **Pagamentos avulsos**,
    **Pagamentos mensais**, **A pagar (professores)** e do **Histórico geral** há uma caixa de busca
    por nome (aluno, professor ou despesa). Ela ignora maiúsculas e acentos ("jose" acha "José"),
    procura em qualquer parte do nome ("ana" também acha "Mariana"), aceita várias palavras em
    qualquer ordem ("souza ana") e continua ativa depois que você marca algo. O botão **×** ou a tecla
    Esc limpam a busca; trocar de aba também. Com a busca ligada, o contador mostra "Mostrando X de Y"
    e os totais (por mês no Histórico; no cabeçalho de Mensais e A pagar) passam a somar só o que
    está à mostra. **Marcou como pago sem querer?** Logo depois de cada "Marcar recebido/pago" (aula,
    mês inteiro, mensalidade, fatura de professor ou despesa) aparece uma mensagem com o botão
    **Desfazer**, que fica 12 segundos e volta exatamente aquele item para pendente (no "mês inteiro",
    só as aulas que aquele clique marcou; as que já estavam pagas antes continuam pagas). Marcações
    em sequência geram mensagens empilhadas, cada uma com o seu Desfazer. Depois disso, o caminho
    continua sendo o **Histórico**: busque pelo nome e use "Voltar para pendente".
  - **Pagamentos avulsos** — alunos que pagam **por aula**, cobrados aula a aula
    (alunos de pagamento mensal nunca aparecem aqui). A lista é agrupada **por aluno e,
    dentro de cada um, por mês**. O total "a receber agora" soma só as aulas que **já
    aconteceram** e ainda não foram pagas; as aulas futuras já agendadas (por exemplo, de
    uma série recorrente) aparecem separadas, marcadas "ainda não aconteceu", e só viram
    cobrança quando acontecerem — mas dá para receber adiantado se o aluno pagar antes.
    Cada aula tem seu botão "Marcar recebido", e cada mês de cada aluno tem **"Marcar o
    mês como recebido"**, que recebe todas as aulas daquele aluno naquele mês de uma vez
    (com confirmação, avisando se inclui aulas que ainda não aconteceram).
  - **Pagamentos mensais** — alunos marcados como "pagamento mensal" no cadastro. Uma
    cobrança por aluno por mês, mostrando o **total de todas as aulas dele naquele mês
    somadas** (o mês inteiro conta, inclusive aulas que ainda vão acontecer; aulas
    canceladas não entram), com a lista dos dias. Enquanto está pendente, o total
    acompanha as aulas (se uma for adicionada, editada ou cancelada, ele muda sozinho).
    Ao marcar como recebida, o valor recebido **fica fixo** — por isso, se ainda há aulas
    por vir no mês, o sistema pede confirmação antes. Importante: o valor da mensalidade
    vem do "valor que o aluno paga" de cada aula; se alguma aula de um aluno mensalista
    estiver com R$ 0,00, aparece um aviso em vermelho.
  - **A pagar** — as faturas quinzenais dos professores (geradas automaticamente ao fim
    de cada quinzena). Em "Quinzenas em andamento", **Previsto** é o que a fatura terá
    se nada mudar (todas as aulas agendadas na quinzena, as que já aconteceram e as que
    ainda vão acontecer) e **Já dado** é só a parte que já aconteceu até agora. O mesmo
    vale na ficha do professor e na área dele, que também dizem se cada quinzena está
    "em andamento", "encerrada" ou "ainda não começou".
  - Em **Despesas**, além de lançar uma despesa avulsa, dá para cadastrar **despesas
    recorrentes** (assinaturas mensais, aluguel, etc.): você define descrição, valor e
    o dia do mês, e a partir daí uma despesa é gerada sozinha todo mês naquele dia —
    você só marca como paga quando quitar. Editar o valor do gabarito atualiza a
    despesa deste mês automaticamente, mas só se ela ainda não tiver sido paga (uma já
    paga nunca muda, igual às faturas de professor). "Desativar" para as gerações
    futuras sem apagar o que já existe.
  - Em **Histórico**, dá para buscar por **nome do aluno ou do responsável** e ver,
    mês a mês (com setas pra navegar entre meses), quais aulas daquele aluno já foram
    pagas e quais ainda estão pendentes — incluindo a mensalidade, se for aluno de
    pagamento mensal. Na ficha do aluno, cada aula paga (e a mensalidade paga) também tem o botão
    **"Voltar para pendente"**. Sem busca, a tela mostra o histórico geral organizado em três
    categorias (três botões no topo: "Recebido de alunos", "Pago a professores", "Pago
    em despesas"), cada uma agrupada mês a mês com o subtotal de cada mês, do mais
    recente para o mais antigo. Cada item do histórico geral tem um botão **"Voltar para pendente"** (desfaz o "marcar como recebido/pago" — útil se marcou sem querer) e um **"Excluir"**,
    que remove de vez (não é só "desmarcar como pago" — some do registro e de todos os
    cálculos). Excluir uma aula paga cancela ela por completo, como na agenda. Único
    cuidado: excluir a **fatura de um professor** (não a aula em si) só impede que o
    valor volte a aparecer se você também cancelar as aulas daquela quinzena — do
    contrário, como o valor ainda é devido com base nelas, uma fatura pendente pode
    ser gerada de novo automaticamente (isso só vale para quinzenas de até 3 meses
    atrás; mais antigas que isso não voltam).

### Sobre o link da aula (Google Meet)

O formulário de agendamento tem um campo para colar o link da aula (Google Meet, Zoom,
ou qualquer outro). Uma integração que *gerasse* o link automaticamente exigiria
cadastrar o sistema como aplicativo no Google (OAuth, chaves de API, tela de permissão)
— um projeto à parte. Por ora, a forma mais simples é abrir o Google Meet
(meet.google.com/new) ou sua agenda do Google, gerar o link em segundos e colar no
campo. Se no futuro fizer sentido automatizar isso, dá para adicionar depois sem mudar
o resto do sistema.

### Calendário no celular (visão "Mês")

O calendário é o mesmo em todo lugar: **Agendamento**, ficha do **aluno** e do **professor**
(aba "Calendário de aulas") e as áreas do aluno e do professor. Ele se adapta ao tamanho da tela:

- **No computador** (tela larga), cada dia mostra até 3 aulas escritas (horário e nome do aluno)
  e, se houver mais, um "+N mais".
- **No celular e no tablet** (tela de até 900 px) não há espaço para escrever as aulas dentro de
  cada quadradinho. Por isso **todo dia que tem aula mostra uma bolinha amarela com a
  quantidade de aulas** daquele dia (no tablet ela diz "3 aulas"; no celular, só o "3").
  Dia sem aula fica sem bolinha. Toque no dia para ver a lista e, nela, em uma aula para ver
  os detalhes. Tocar num dia **sem** aula abre o agendamento de uma nova aula (só no painel
  de administração; nas áreas do aluno e do professor não acontece nada).

### Manual da Área do Aluno (PDF)

No alto da área do aluno (em qualquer aba) há o botão **"Manual do aluno"**: ele abre, numa
nova aba, o guia em PDF de como usar a área — acompanhar as aulas, ver os detalhes e o link
da aula, enviar e receber materiais.

- **Só aluno abre.** Professores, secretaria e visitantes não veem o botão; se alguém
  digitar o endereço do manual mesmo assim, professor e secretaria recebem um aviso ("o
  manual é exclusivo para alunos") e quem não entrou no portal vê um aviso com o link para
  entrar. O PDF **não fica numa pasta pública** do site: ele só sai depois de o portal conferir que
  quem está pedindo é um aluno logado (e ativo — se você excluir o aluno, ele perde o
  acesso na hora).
- **Onde está o arquivo:** `server/assets/manual-aluno.pdf`, junto com o resto do projeto (não
  fica no volume de dados). Não confunda com `public/assets/`, que é a pasta pública do logo.
- **Para trocar o manual por uma versão nova:** salve o PDF novo com **exatamente** o nome
  `manual-aluno.pdf`, coloque-o no lugar do antigo na pasta `server/assets/` do repositório
  do portal (no GitHub: abra a pasta `server/assets`, **Add file → Upload files**, arraste o
  PDF e clique em **Commit changes**) e espere o Railway publicar. Mais nada muda, e quem já
  abriu o manual antes recebe a versão nova automaticamente. O GitHub pelo navegador aceita
  arquivos de até 25 MB.
- **Tamanho:** o manual atual tem cerca de 10 MB. Num celular com internet fraca, um PDF
  menor abre mais rápido — se for refazer o manual, vale exportar numa qualidade/tamanho menor.

---

## 6. Materiais de aula — como funciona, limites e como ajustar

**O que é.** Um lugar para professores e alunos compartilharem o que se usa nas aulas: listas
de exercícios, foto do caderno, slides, planilhas, links de vídeo. Aparece como aba
**Materiais** na área do professor, na área do aluno e na ficha do aluno (secretaria), e como
página **Materiais** no menu da secretaria (visão geral e espaço usado).

### Quem faz o quê

| | Vê | Envia | Apaga |
|---|---|---|---|
| **Professor** | os materiais dos **seus** alunos (quem tem aula agendada com ele) | para os seus alunos | qualquer material dos seus alunos |
| **Aluno** | tudo que é dele, de todos os professores | para os professores dele (se a secretaria deixar) | só o que ele mesmo enviou |
| **Secretaria** | tudo | — (só vê e apaga) | qualquer material; ou todos de um aluno de uma vez |

Os materiais pertencem ao **par aluno–professor**: o que o professor Marcos envia para a
Carolina só aparece para a Carolina, para o Marcos e para a secretaria — nunca para outro
aluno ou outro professor. O par existe enquanto houver ao menos **uma aula agendada** entre
os dois (aula cancelada não conta). Se um professor deixar de ter aulas agendadas com um
aluno, ele deixa de ver os materiais desse aluno; o aluno continua vendo os dele. Quem a
pessoa é vem sempre do login, nunca de algo que o navegador informe.

### Limites

- **50 MB por arquivo** e **4,5 GB no total** (todos os arquivos somados).
- O portal também recusa novos envios quando o volume está com menos de **200 MB livres**: o
  banco de dados mora no mesmo volume e nunca pode ficar sem espaço.
- Passou de 80% do teto: aparece um aviso no Painel inicial, e a barra da página Materiais
  muda de cor (amarela até 95%, vermelha depois).
- Para mudar, defina variáveis de ambiente no serviço (Railway → Variables), em MB
  (1 MB = 1.000.000 bytes): `MATERIALS_MAX_FILE_MB` (padrão 50), `MATERIALS_MAX_TOTAL_MB`
  (padrão 4500) e `MATERIALS_MIN_FREE_MB` (padrão 200; `0` desliga a proteção). Depois de
  salvar a variável, aplique a mudança na Railway (o botão **Deploy** que ela mostra) para o
  serviço reiniciar com o valor novo. Aumentar o teto só adianta se o volume tiver espaço de
  verdade (veja "Quando o espaço acabar").
- **Envio pelo celular ou internet lenta:** a Railway interrompe qualquer envio que demore
  mais de **5 minutos**. Um arquivo de 50 MB precisa de pelo menos ~1,4 Mbps de envio
  contínuo. Se a internet cair, a tela mostra "Tentar de novo". Para arquivos grandes ou
  conexão ruim, o caminho é o **link** (YouTube, Google Drive…).

### Tipos de arquivo

- **Aceitos:** PDF, imagens (JPG, PNG, GIF, WEBP), Word (.docx), PowerPoint (.pptx) e Excel
  (.xlsx). O portal confere o **conteúdo** do arquivo, não só o nome: um programa renomeado
  para `.pdf` é recusado.
- **Recusados de propósito:** vídeos e áudios (pesam demais — use um link), compactados
  (.zip, .rar), formatos antigos do Office (.doc, .ppt, .xls — salvar como .docx/.pptx/.xlsx),
  fotos HEIC do iPhone (converter para JPG) e tudo que um navegador consegue executar
  (.html, .svg, .js, .exe), por segurança. A tela explica o motivo em cada caso.
- **Liberar mais um tipo:** acrescente uma linha em `FILE_TYPES`, no arquivo
  `server/materials.js` (com a conferência dos primeiros bytes do arquivo, se houver). A tela
  lê a lista pelo servidor, então não precisa mexer em mais nada.
- **Links:** além de arquivos, dá para salvar um link (YouTube, Google Drive, Khan
  Academy…). Mesma regra dos links de aula: sempre `https://`, e só endereços da internet.

### Onde ficam os arquivos e como são protegidos

Na pasta `materiais`, dentro do `DATA_DIR` (na Railway, o volume `/data`), com **nomes
aleatórios** — o nome verdadeiro só existe no banco, para mostrar na tela e dar nome ao
download. A pasta fica **fora do site público**: o único caminho para baixar é pelo portal,
que confere login e permissão a cada download. Os arquivos são sempre entregues como
anexo (imagens só abrem no navegador quando a pessoa clica em "Abrir"), sem cache e com
cabeçalhos que impedem o navegador de interpretar o arquivo como uma página. Material que
não existe e material que a pessoa não pode ver dão a mesma resposta ("não encontrado").

### Decisões que tomei por você (e como mudar cada uma)

1. **Alunos também podem enviar** (não só professores). Para desligar: menu **Materiais** →
   desmarque "Permitir que os alunos enviem materiais". Os alunos continuam vendo e
   baixando o que receberam; só deixam de enviar.
2. **Os materiais pertencem ao par aluno–professor** (tabela acima), e a secretaria só vê e
   apaga (não envia). Todas as regras de permissão estão num único arquivo comentado,
   `server/routes/materials.js`; se quiser outro modelo (por exemplo, materiais abertos a
   todos os alunos de uma turma), é ali que muda.
3. **Os materiais ficam guardados até alguém apagar** — não há prazo de validade
   automático. Professor apaga qualquer material dos seus alunos; aluno apaga só os que
   enviou; secretaria apaga qualquer um. Apagar remove o arquivo do disco na hora e devolve
   o espaço. Na ficha do aluno há **"Apagar todos os materiais deste aluno"** (útil quando o
   aluno encerra). **Remover um aluno não apaga os materiais dele** (o histórico é preservado,
   como nas aulas e pagamentos): o aviso de "Remover aluno" mostra quantos materiais ele tem
   e onde apagar. Depois de removido, os materiais continuam na página Materiais (é só
   buscar pelo nome), e o link do aluno ali leva até a ficha, onde o botão de apagar tudo
   continua funcionando.

### Quando o espaço acabar

1. **Apague o que não é mais usado.** Na página Materiais, "Maiores primeiro" mostra o que
   mais pesa; na ficha do aluno há o apagar-tudo.
2. **Aumentar o teto** (`MATERIALS_MAX_TOTAL_MB`) só ajuda se o volume tiver espaço: no plano
   Hobby o volume vai até 5 GB (a Railway lista "até 5 GB"). Para mais que isso é preciso o
   plano Pro ou levar os arquivos para fora da Railway.
3. **Levar os arquivos para fora da Railway**, por exemplo para o **Cloudflare R2** (10 GB
   grátis por mês e sem cobrança de saída de dados). É um trabalho à parte, mas está
   preparado: todo acesso aos arquivos passa por `server/materials.js`, então a troca fica
   concentrada ali, sem mexer nas telas nem nas permissões.

### Backup dos arquivos

O botão "Baixar backup dos dados" salva **só o banco**: cadastros, aulas, pagamentos e a
*lista* de materiais (título, quem enviou, nome do arquivo). Os **arquivos** em si ficam só
no volume da Railway, e o backup de volume da Railway não funciona no plano Hobby (a aba
"Backups" aparece, mas não deixa criar — veja a seção 4). Na prática:

- Se o volume for perdido, os arquivos se perdem e a lista passa a apontar para arquivos que
  não existem (quem tenta baixar vê "Este arquivo não está mais disponível no servidor"; basta
  apagar o item).
- Trate os materiais como **cópias de trabalho**: o original continua com quem enviou
  (professor ou aluno). Para material de aula, isso costuma bastar.
- Se um dia os arquivos forem importantes demais para depender só do volume, as saídas são:
  plano Pro da Railway com backup de volume (atenção: o backup manual da Railway é limitado
  a **50% do tamanho do volume**, então para proteger o teto de 4,5 GB o volume precisaria
  ter ~9 GB) ou levar os arquivos para o R2 (item 3 acima), que tem durabilidade própria.

### Problemas comuns

- **"Não há espaço suficiente no armazenamento de materiais"** — o teto de 4,5 GB (ou os
  200 MB livres do volume) foi atingido. Veja "Quando o espaço acabar".
- **O envio falha ou demora muito no celular** — a Railway corta envios acima de 5 minutos
  e o navegador precisa ficar com a tela aberta durante o envio. Tente por Wi-Fi, mande um
  arquivo menor ou use um link.
- **"O conteúdo deste arquivo não confere com o tipo dele"** — o arquivo está corrompido ou
  foi renomeado (por exemplo, uma imagem chamada `.pdf`). Abra e salve de novo no formato
  certo.
- **Uma pessoa não vê um material que deveria ver** — confira se ainda existe uma aula
  **agendada** entre o professor e o aluno (aulas canceladas não contam), e se o aluno e o
  professor continuam ativos.
- **Depois de publicar a atualização:** as tabelas novas de Materiais são criadas sozinhas na
  primeira vez que o servidor liga; nada do que já existia é alterado.

---

## 7. Banco de talentos — como funciona, limites e cuidados

**O que é.** Uma lista privada das pessoas que você talvez queira chamar para dar aula no
futuro, com os dados de contato, o currículo e as suas anotações. Aparece no menu da
secretaria como **Banco de talentos** (logo abaixo de Professores) e é **exclusivo da
administração**: não existe nenhuma tela, aba ou link disso na área do professor ou do aluno,
e o servidor confere o login de administração em toda chamada — quem não for administrador
não consegue ver nada, mesmo digitando o endereço na mão.

### O que dá para guardar

| Campo | Observação |
|---|---|
| **Nome** | obrigatório (até 120 caracteres) |
| **Telefone**, **E-mail**, **Endereço** | opcionais; na ficha, o telefone e o e-mail viram links (ligar / escrever) |
| **Disciplinas que poderia lecionar** | a mesma lista de disciplinas dos professores; dá para criar uma disciplina nova ali mesmo |
| **Valor por hora que pretende receber** | presencial e online; é só uma referência para você — não entra em nenhuma conta nem preenche o agendamento sozinho |
| **Disponibilidade** | a mesma grade de Segunda a Domingo, das 8h às 20h, dos professores; é só uma anotação |
| **Currículo** | um arquivo por talento (veja "Currículo — limites e tipos") |
| **Observações** | texto livre de até 5.000 caracteres: como conheceu a pessoa, impressões da entrevista, o que combinaram… |

**Ficam de fora de propósito:** login e senha, PIX e transporte. Só fazem sentido quando a
pessoa é contratada, e assim você não guarda dados de acesso nem de pagamento de quem ainda
não trabalha com você.

### Como usar

1. No menu, **Banco de talentos** → **+ Cadastrar talento**. Só o nome é obrigatório; o resto
   você preenche quando tiver. O currículo pode ser anexado já no cadastro ou depois, pela ficha.
2. A **lista** mostra nome, disciplinas, contato, valor/hora pretendido e se há currículo. A
   caixa de busca procura em nome, disciplinas, telefone, e-mail, endereço, observações e no
   nome do arquivo do currículo, sem diferenciar maiúsculas nem acentos ("jose" acha "José");
   ao lado há um filtro por disciplina. Clique numa linha para abrir a ficha.
3. A **ficha** reúne os dados cadastrais (botão **Editar**), o currículo (**Abrir**,
   **Baixar**, **Trocar**, **Remover currículo**), as observações (**Editar** → **Salvar
   observações**, sem abrir o formulário) e a disponibilidade.
4. **Remover**, no alto da ficha, apaga de vez o talento, as observações e o currículo, depois
   de uma confirmação. Não existe lixeira: não dá para desfazer.
5. **Para contratar:** o talento não vira professor sozinho. Vá em **Professores** →
   **+ Cadastrar professor** e copie os dados da ficha (depois, se quiser, remova o talento do
   banco). Se esse vaivém virar rotina, dá para pedir um botão "Contratar" que já leve os dados.

### Currículo — limites e tipos

- **Um currículo por talento.** Anexar outro **substitui** o anterior (o antigo é apagado).
- **Limites:** **5 MB por currículo** e **200 MB no total** (todos os currículos somados). A tela
  avisa **antes** de enviar quando o arquivo é grande demais ou de um tipo não aceito, e explica
  o que fazer (comprimir o arquivo, exportar de novo, converter).
- **Aceitos:** PDF, Word (.doc e .docx), .odt, .rtf e imagens (JPG, JPEG, PNG, WEBP). Como nos
  Materiais, o portal confere o **conteúdo** do arquivo e não só o nome: um programa renomeado
  para `.pdf` é recusado.
- **Recusados de propósito:** tudo que um navegador consegue executar (.html, .svg, .js, .exe),
  compactados (.zip, .rar), fotos HEIC do iPhone (converter para JPG) e arquivos do Pages
  (exportar como PDF ou Word).
- **Abrir ou baixar:** PDF e imagens podem abrir direto no navegador (botão **Abrir**); os
  demais tipos sempre baixam. O arquivo só sai depois de o portal conferir o login de
  administração, nunca fica numa pasta pública e é entregue com cabeçalhos que impedem o
  navegador de tratá-lo como página.
- **Mudar os limites:** variáveis de ambiente no serviço (Railway → Variables), em MB
  (1 MB = 1.000.000 bytes): `TALENTS_CV_MAX_MB` (padrão 5) e `TALENTS_CV_TOTAL_MB` (padrão 200).
  Vazio, inválido ou `0` volta ao padrão. Depois de salvar a variável, aplique a mudança na
  Railway (o botão **Deploy** que ela mostra) para o serviço reiniciar com o valor novo. Não
  exagere nos números: o currículo mora dentro do banco de dados (veja a seguir).

### Onde ficam os currículos e o backup

Diferente dos arquivos dos Materiais, que ficam numa pasta do volume, o currículo é guardado
**dentro do próprio banco de dados** (tabela `talent_cvs`). Consequências:

- **Entra no "Baixar backup dos dados"**, junto com o resto: um único backup protege todo o
  Banco de talentos, currículos inclusive. Em compensação, o arquivo de backup fica maior (com
  o teto padrão, até 200 MB a mais) e demora um pouco mais para baixar.
- Sai junto quando o talento é removido, e nunca sobra um arquivo solto no disco.
- Divide o volume com o banco e com os Materiais. Com os tetos padrão, o volume de 5 GB do
  plano Hobby comporta tudo; se você aumentar algum limite, lembre que o espaço é um só.

### Cuidados com os dados pessoais

Os talentos são dados pessoais de pessoas que ainda não trabalham com você (nome, contato,
endereço, currículo, as suas impressões). Boas práticas simples:

- guarde só o que você realmente usa e **remova o talento quando ele deixar de ser uma opção**
  (**Remover** apaga o cadastro e o currículo de vez);
- as cópias do "Baixar backup dos dados" feitas antes da remoção ainda contêm essas
  informações — se alguém pedir para ser apagado, vale também descartar os backups antigos;
- pela LGPD, a pessoa pode pedir para ver ou apagar o que você guardou sobre ela, então escreva
  as observações com isso em mente;
- se a política de privacidade do site não menciona candidatos a professor, vale incluir (ela
  ainda é só um modelo, e o ideal é um advogado revisar — eu não sou advogado).

### Decisões que tomei por você (e como mudar cada uma)

1. **Só a administração vê.** As regras de acesso ficam todas num lugar só, o arquivo comentado
   `server/routes/talents.js`.
2. **Um currículo por talento**, guardado no banco (e não numa pasta), pelos motivos acima.
3. **Sem "status" do candidato** (entrevistado, aprovado, descartado…): as observações cobrem
   isso. Se quiser um campo de status com filtro na lista, dá para acrescentar.
4. **Remover é definitivo** (com confirmação): não há lixeira.
5. **Login, PIX e transporte ficam de fora**, como explicado acima.

### Problemas comuns

- **"O espaço reservado aos currículos (200 MB) está cheio"** — remova currículos que não usa
  mais (ficha do talento → **Remover currículo**) ou aumente `TALENTS_CV_TOTAL_MB`.
- **"Grande demais … o máximo é 5 MB"** — exporte o PDF de novo com qualidade menor, comprima
  as imagens ou aumente `TALENTS_CV_MAX_MB`.
- **"O conteúdo deste arquivo não confere com o tipo dele"** — o arquivo está corrompido ou foi
  renomeado (por exemplo, uma imagem chamada `.pdf`). Abra e salve de novo no formato certo.
- **O talento foi salvo, mas o currículo não subiu** — acontece quando a internet cai ou o
  servidor recusa o arquivo no meio do cadastro. Os dados **não se perdem**: você cai na ficha
  do talento, com o motivo numa mensagem em vermelho, e é só anexar o currículo de novo ali.
- **A busca não acha uma pessoa** — ela procura em nome, disciplinas, telefone, e-mail,
  endereço, observações e nome do arquivo do currículo (não *dentro* do currículo) e usa só os
  100 primeiros caracteres do que for digitado.
- **Depois de publicar a atualização:** as tabelas novas (`talents`, `talent_subjects` e
  `talent_cvs`) são criadas sozinhas na primeira vez que o servidor liga; nada do que já existia
  é alterado. Se precisar voltar para a versão anterior do portal, é seguro: as tabelas novas
  ficam ali, sem uso, e tudo volta a funcionar como antes.

---

## 8. Controle de interessados — como funciona e cuidados

**O que é.** Uma lista privada dos pais e responsáveis que entraram em contato, perguntaram sobre
as aulas e, pelo menos nesse primeiro contato, não agendaram nada. Serve para você não perder
esses contatos e poder retomá-los depois (começo de semestre, época de prova, uma promoção…).
Aparece no menu da secretaria como **Interessados** (logo abaixo de Alunos) e é **exclusivo da
administração**: não existe nenhuma tela, aba ou link disso na área do professor ou do aluno, e o
servidor confere o login de administração em toda chamada — quem não for administrador não
consegue ver nada, mesmo digitando o endereço na mão.

### O que dá para guardar

| Campo | Observação |
|---|---|
| **Nome do responsável** | o **único obrigatório** (até 120 caracteres) |
| **Telefone / WhatsApp**, **E-mail** | opcionais; na ficha, o telefone e o e-mail viram links (ligar / escrever) |
| **Nome do aluno** e **Série** | opcionais; a série traz as mesmas sugestões do cadastro de alunos e aceita outro texto |
| **Disciplinas de interesse** | a mesma lista de disciplinas do sistema; dá para criar uma disciplina nova ali mesmo |
| **Modalidade de interesse** | Presencial, Online ou Tanto faz |
| **Como conheceu a Olimais** | Instagram, Site, Google, Indicação, WhatsApp, Facebook ou Outro |
| **Situação** | Novo (o padrão), Em conversa, Retornar depois, Virou aluno ou Sem interesse |
| **Data do primeiro contato** | já vem com o dia de hoje; dá para mudar ou apagar |
| **Retornar em** | opcional: o dia em que você quer voltar a falar com a pessoa |
| **Observações** | texto livre de até 5.000 caracteres: o que perguntou, o que achou do valor, o que combinaram… |

### Como usar

1. No menu, **Interessados** → **+ Cadastrar interessado**. Só o nome é obrigatório; o resto você
   preenche com o que souber (e completa depois, pela ficha).
2. A **lista** mostra, do contato mais recente para o mais antigo, o responsável (com aluno e
   série embaixo), o contato, as disciplinas, a situação, a data do primeiro contato e a data de
   retorno. A caixa de busca procura em nome, telefone, e-mail, aluno, série, observações,
   disciplinas, situação, modalidade e origem, sem diferenciar maiúsculas nem acentos ("luiza"
   acha "Luíza"); um telefone digitado só com números também funciona. Ao lado há filtros por
   **situação** e por **disciplina**, que valem junto com a busca. Clique numa linha para abrir a ficha.
3. **Retorno:** quando a data de retorno de um caso em aberto (Novo, Em conversa ou Retornar
   depois) é hoje, a lista mostra **Hoje**; se já passou, mostra **Atrasado**. Casos encerrados
   (Virou aluno, Sem interesse) não geram aviso, mesmo com data. O sistema só **mostra** isso:
   não manda mensagem, e-mail nem lembrete sozinho, e o Painel não mostra esses avisos.
4. A **ficha** reúne o contato e o interesse (**Editar**), o acompanhamento (a **situação** muda ali
   mesmo, numa caixa de escolha) e as observações (**Editar** → **Salvar observações**, sem abrir
   o formulário).
5. **Remover**, no alto da ficha, apaga de vez o cadastro, depois de uma confirmação. Não existe
   lixeira: não dá para desfazer.
6. **Quando o interessado vira aluno:** troque a situação para **Virou aluno** e cadastre o aluno
   normalmente em **Alunos**. O sistema não copia os dados sozinho; se esse vaivém virar rotina,
   dá para pedir um botão "Cadastrar como aluno" que já leve os dados.

### Onde ficam os dados e o backup

Ficam no próprio banco de dados (tabelas `leads` e `lead_subjects`), junto com o resto. Por isso
entram no **"Baixar backup dos dados"** e não ocupam nenhuma pasta à parte. O volume de dados é
pequeno (texto), então não há limite de quantidade nem mudança de espaço a considerar.

### Cuidados com os dados pessoais

Os interessados são dados pessoais de pais e de crianças (nome, telefone, e-mail, nome e série do
aluno) de gente que ainda não é sua cliente. Boas práticas simples:

- guarde só o que você realmente usa e **remova o cadastro de quem pediu para sair ou deixou de
  fazer sentido** (**Remover** apaga de vez);
- ao retomar o contato, identifique-se e diga de onde conhece a pessoa; se ela pedir para não ser
  mais procurada, marque **Sem interesse** (ou remova) e não procure de novo;
- as cópias do "Baixar backup dos dados" feitas antes de uma remoção ainda contêm essas
  informações — se alguém pedir para ser apagado, vale também descartar os backups antigos;
- pela LGPD, a pessoa pode pedir para ver ou apagar o que você guardou sobre ela, então escreva as
  observações com isso em mente;
- se a política de privacidade do site não menciona o contato com interessados, vale incluir (ela
  ainda é só um modelo, e o ideal é um advogado revisar — eu não sou advogado).

### Decisões que tomei por você (e como mudar cada uma)

1. **Só a administração vê.** As regras de acesso ficam todas num lugar só, o arquivo comentado
   `server/routes/leads.js`.
2. **Cinco situações fixas** (Novo, Em conversa, Retornar depois, Virou aluno, Sem interesse). A
   lista fica em `server/leads.js` (`STATUSES`); trocar nomes ou acrescentar outra é rápido de
   pedir. Modalidades e origens também são listas fixas (`MODALITIES` e `SOURCES`, no mesmo arquivo).
3. **O aviso de retorno aparece só na lista e na ficha**, sem aviso no Painel, por e-mail ou por
   WhatsApp. Se quiser um lembrete mais ativo (por exemplo, "retornos de hoje" no Painel), dá para pedir.
4. **Remover é definitivo** (com confirmação): não há lixeira.
5. **Sem verificação de repetidos:** se a mesma pessoa for cadastrada duas vezes, os dois
   cadastros aparecem (uma busca pelo telefone mostra os dois).
6. **Não vira aluno sozinho**, como explicado acima.

### Problemas comuns

- **A busca não acha uma pessoa** — ela procura em nome, telefone, e-mail, aluno, série,
  observações, disciplinas, situação, modalidade e origem (não nas datas) e usa só os 100
  primeiros caracteres do que for digitado. Confira também se algum filtro de situação ou de
  disciplina ficou marcado ao lado da busca.
- **A data do primeiro contato está em branco** — ela já vem preenchida com o dia de hoje em todo
  cadastro novo; se alguém a apagou, fica em branco (e a lista põe esses casos no fim). Para
  preencher, **Editar** na ficha.
- **Depois de publicar a atualização:** as tabelas novas (`leads` e `lead_subjects`) são criadas
  sozinhas na primeira vez que o servidor liga; nada do que já existia é alterado. Se precisar
  voltar para a versão anterior do portal, é seguro: as tabelas novas ficam ali, sem uso, e tudo
  volta a funcionar como antes.

---

## 9. Confirmação das aulas pelo WhatsApp — como funciona e cuidados

> O passo a passo para ligar a integração com a Meta (conta, número, modelos, token, webhook) está
> no arquivo **GUIA-WHATSAPP.md**. Aqui está o que o sistema faz depois de ligado.

### Status de confirmação (todas as aulas)
Toda aula tem, além de "agendada/cancelada", um **status de confirmação**:
**Pendente confirmação** (padrão de toda aula nova), **Aula confirmada** e **Pedido de cancelamento**.
- "Pedido de cancelamento" **não tira a aula das estatísticas, das contas a receber nem do pagamento
  do professor**. A aula só some se a administração a excluir ("Cancelar aula").
- A administração pode trocar o status a qualquer momento, na janela da aula (seção "Confirmação da aula").
- Mudar o **horário** ou o **aluno** de uma aula volta o status para "pendente" e descarta o aviso antigo.
- Professores e alunos **não veem** o status nem nada sobre a confirmação.
- Pedidos de cancelamento aparecem em **vermelho** no calendário e num cartão no **Painel**.

### O que acontece sozinho (com a integração ligada)
1. **24h antes** da aula, o sistema manda o modelo de mensagem com os botões **Sim / Não** para o
   responsável (ou para o próprio aluno, se o cadastro dele tiver "Quem confirma = o próprio aluno").
   Aulas criadas com menos de 24h de antecedência recebem o aviso assim que o sistema perceber
   (até 1 minuto), desde que faltem mais de 5h.
2. **Sim** → status "Aula confirmada" (origem: WhatsApp).
3. **Não** → status "Pedido de cancelamento", marcação vermelha, cartão no Painel e **mensagem
   automática para o WhatsApp da Olimais** (número de alertas, configurado na página WhatsApp).
4. **Sem resposta**: 5h antes da aula, a aula que recebeu o aviso é **confirmada automaticamente**.
   Aula cujo aviso não foi entregue (erro) **não** é confirmada sozinha — fica pendente e aparece
   para você resolver.
5. O responsável recebe uma resposta automática curta ("aula confirmada" / "recebemos o seu pedido").
   Dá para desligar na página WhatsApp.

### Onde fica tudo
Menu **WhatsApp** (só administração): situação da conexão, testar conexão, ligar/desligar, número de
alertas, nomes dos modelos, mensagens de teste, textos dos modelos para copiar e o **histórico** das
mensagens (enviadas, entregues, lidas, falhas e respostas recebidas; guardado por 90 dias).
A integração **vem desligada** — nada é enviado até você ligar.

### Variáveis da Railway (nunca no chat, nunca no GitHub)
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` e,
opcional, `WHATSAPP_WABA_ID` (mostra a situação dos modelos). Detalhes no GUIA-WHATSAPP.md.

### Decisões que tomei por você
- O texto da mensagem é o que você enviou (3 variáveis: aluno, data, horário). Disciplina e professor
  não estão nele; dá para acrescentar (basta criar um novo modelo na Meta com mais variáveis).
- Respostas **digitadas** só valem se forem exatamente "sim"/"não" (ou pedidos claros como "preciso
  remarcar") e se houver **uma** aula esperando aquele telefone; senão, ficam só no histórico.
- Mensagens livres escritas para o número da API **não** aparecem no WhatsApp comum: só no histórico
  do portal. Use um número só para a API (não o do aplicativo).
- Falhas temporárias são tentadas de novo (até 5 vezes, a cada 10 minutos).

### Cuidados (LGPD e custos)
- Só envie para quem já é cliente e aceitou ser contatado; o telefone cadastrado é usado só para isso.
- A Meta cobra por mensagem (modelos "utilitários"); confira a tabela de preços atual dela.
- O histórico (`wa_messages`) entra no "Baixar backup dos dados".

### Problemas comuns
Veja a seção de problemas do GUIA-WHATSAPP.md.

---

## 10. Solução de problemas

- **"Cannot find module 'node:sqlite'" ou erro parecido ao iniciar** — a versão do
  Node em uso é anterior à 22.5. Confira em Settings do serviço (Railway/Render) se dá
  para fixar a versão do Node, ou adicione um arquivo `.node-version` na raiz do
  projeto contendo `22` para ajudar o serviço a escolher a versão certa.
- **Perdi os dados depois de publicar uma atualização** — o volume/disco persistente
  não foi configurado (passo "d" acima), ou o `DATA_DIR` não bate com o caminho onde
  ele foi montado.
- **O botão "Manual do aluno" mostra "O manual não está disponível no momento"** — o
  arquivo `server/assets/manual-aluno.pdf` não está no projeto publicado (foi apagado ou o
  nome mudou). Suba o PDF de novo com esse nome exato e espere a publicação.
- **Um aluno diz que o manual "não abriu" no celular** — em alguns celulares Android o PDF
  é baixado em vez de aparecer na tela: é só abrir o arquivo na notificação ou na pasta
  Downloads. Se aparecer "Entre na Área do Aluno", a sessão dele expirou: basta entrar de novo.
- **Não consigo anexar um currículo no Banco de talentos** — a tela explica o motivo (arquivo
  acima de 5 MB, tipo não aceito, conteúdo que não confere ou espaço de currículos cheio). O que
  fazer em cada caso está na seção 7, em "Problemas comuns".
- **Quero trocar meu e-mail ou senha de administrador (e sei a senha atual)** — não
  precisa mexer no banco de dados: clique em **"Minha conta (e-mail / senha)"**, no
  rodapé do menu lateral. Pede a senha atual para confirmar, e deixa trocar o e-mail,
  a senha, ou os dois juntos.
- **Esqueci a senha do administrador** (não sei a senha atual, então a tela acima não
  ajuda) — abra um terminal (Shell) no painel do serviço
  de hospedagem e rode `node -e "console.log(require('./server/auth').hashPassword('nova-senha'))"`,
  depois atualize manualmente a coluna `password_hash` da tabela `admins` com esse
  valor (dá para abrir o `sistema.db` com qualquer cliente SQLite). É um processo
  manual porque, de propósito, não existe uma tela de "esqueci minha senha" que
  dependeria de configurar envio de e-mails. Para um **professor** que esqueceu a
  senha, é mais simples: edite o cadastro dele (Professores → abrir o professor →
  Editar) e defina uma nova senha no campo de acesso.
- **Quero adicionar uma segunda pessoa com login de administração** — hoje o sistema
  foi pensado para um único acesso de administração (como descrito no pedido original,
  "sistema interno"); isso é diferente do login dos professores, que já é multiusuário
  (cada professor tem o próprio, cadastrado por você). Para uma segunda pessoa
  administrando tudo, dá para cadastrar outra conta manualmente inserindo uma linha na
  tabela `admins` (mesmo processo de hash de senha do item acima); se isso for algo que
  você vai precisar com frequência, vale pedir para transformar isso em uma tela.

---

## 11. Estrutura do projeto

```
server/           todo o backend (servidor, banco de dados, regras de negócio, rotas)
  db.js             conexão com o SQLite e criação das tabelas
  links.js          regra dos links (aula online e materiais): sempre https://
  materials.js      arquivos dos materiais: limites, tipos aceitos, gravação e download
  talents.js        banco de talentos: conferência dos campos, busca e currículo (guardado no banco)
  leads.js          controle de interessados: conferência dos campos, situações, busca e retorno
  services.js        regras de negócio: quinzenas, conflitos, faturas, recorrência
  auth.js            login/senha/sessão
  router.js          roteador HTTP simples (sem framework)
  routes/            um arquivo por área (alunos, professores, agendamento, pagamentos,
                     materiais — este com todas as regras de quem pode ver/enviar/apagar —,
                     talentos e interessados — só administração —, whatsapp (webhook + painel) e manual, que entrega o
                     PDF do manual só para alunos logados)
  assets/            arquivos entregues só depois do login (hoje: manual-aluno.pdf;
                     não confundir com public/assets/, que é pública)
  confirmation.js    status de confirmação das aulas (pendente/confirmada/pedido de cancelamento)
  whatsapp/          integração com o WhatsApp Business (API da Meta): config, telefones, modelos de
                     mensagem, cliente HTTP, regras de envio/resposta, webhook e relógio automático
  index.js           ponto de entrada — inicia o servidor
public/            todo o frontend (HTML/CSS/JS puro, sem build)
  index.html         estrutura principal do site (depois do login, para a secretaria)
  login.html         tela de login
  professor.html     área exclusiva de cada professor logado
  aluno.html         área exclusiva de cada aluno logado
  assets/            arquivos da identidade visual (ver nota abaixo)
  css/style.css      estilo visual
  js/                lógica de cada página + calendário + funções compartilhadas
```

**Sobre a pasta `public/assets/`**: `logo-icon.svg` é a marca usada de verdade no site (sidebar,
tela de login, favicon) — é a versão em vetor puro, leve, que fica nítida em qualquer tamanho.
`logo-9.svg` e `logo-13.svg` são as outras duas variantes que você enviou, guardadas aqui como
referência para uso fora do site (papelaria, redes sociais, etc.) — elas têm partes em imagem
(não só vetor) e arquivos bem mais pesados, por isso não são as usadas no site em si. Se preferir
usar uma delas no lugar da atual, é só me pedir.
