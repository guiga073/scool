# Olimais — Sistema de Gestão

Sistema interno de gestão para o seu reforço escolar: cadastro de alunos e professores,
agendamento de aulas com calendário, e controle de pagamentos (a receber dos alunos e a
pagar aos professores, quinzenalmente).

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

- **Alunos** — cadastro completo (nome, endereço, responsáveis, telefone). A caixa
  "Pagamento mensal" faz o aluno aparecer em **Pagamentos → Pagamentos especiais** em
  vez de na lista de cobrança por aula — as aulas dele continuam no calendário
  normalmente. O valor da mensalidade **não** é definido no cadastro: toda mensalidade
  nasce com R$ 0,00 e você define/edita o valor de cada mês diretamente em Pagamentos →
  Pagamentos especiais (clique em "Definir valor"). Assim como o professor, cada aluno
  também pode ter um **login próprio** (e-mail + senha, preenchidos por você no
  cadastro): com ele, o aluno entra pelo mesmo endereço do site e cai numa área só dele
  (`/aluno.html`), com duas abas — "Minhas aulas" (a própria agenda: dia, horário,
  disciplina, professor, e o link quando a aula é online) e "Feedbacks" (tudo que os
  professores já escreveram sobre ele, de forma só de leitura — quem escreve é sempre
  o professor). Na ficha do aluno: dados, calendário de aulas, notas e observações.

  **Gerar login para todos os alunos de uma vez**: na lista de Alunos, o botão
  **"Gerar usuários e senhas para todos"** cria, para cada aluno cadastrado, um usuário
  (primeiro nome + sobrenome, sem espaço/acento — ex.: "joaosilva"; se já existir
  alguém com esse mesmo usuário, seja aluno, professor ou admin, entra um número no
  final automaticamente) e uma senha de 5 caracteres, e baixa uma planilha CSV com
  tudo. Mesma regra de segurança do botão equivalente de Professores: a senha só
  aparece em texto nesse momento — depois disso, não tem como ver de novo. O campo de
  login (tanto de aluno quanto de professor) aceita usuário simples ou e-mail de
  verdade, e a tela de login também — não precisa ser um e-mail.
- **Professores** — cadastro com disciplinas e PIX, com busca por nome na lista. Tem
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
  marcadas, preenche a própria disponibilidade, e registra **feedback de aula** para
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
- **Feedbacks** — uma aba própria no menu, só para a secretaria, para consultar o
  feedback já registrado sem precisar entrar na ficha de cada professor. Alterna entre
  "Por aluno" (busca um aluno e vê o feedback de todos os professores dele, cada item
  já indicando qual professor escreveu) e "Por professor" (busca um professor e vê o
  feedback que ele deu para todos os alunos dele). Tem o mesmo botão "Ver como texto" e
  a opção de excluir um item, se precisar.
- **Financeiro** — visão geral do negócio: receita, custos e lucro do mês atual, um
  gráfico comparando os últimos 6 ou 12 meses, e dois rankings do mês — faturamento por
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
- **Agendamento** — ao marcar uma aula você escolhe aluno → modalidade → disciplina →
  professor (a lista de professores já vem filtrada pela disciplina escolhida) → data e
  horário → valores → link da aula. Quando a modalidade é **presencial**, o formulário e
  a agenda mostram o **endereço cadastrado do aluno** em vez do link — é para lá que o
  professor precisa ir. Aulas **online** continuam mostrando só o link, sem endereço. Há
  também uma opção de aula recorrente semanal ("acompanhamento"), que cria uma aula
  individual por semana no período escolhido. Conflitos de horário **avisam** ("⚠️ Foram
  identificados conflitos.") mas nunca bloqueiam o agendamento. Aulas canceladas somem
  de todos os cálculos e telas.
- **Pagamentos** — abas para "A receber" (aulas avulsas pendentes), "A pagar"
  (faturas quinzenais dos professores, geradas automaticamente ao fim de cada
  quinzena), "Pagamentos especiais" (mensalistas), "Despesas" e "Histórico". Nada
  pendente desaparece sozinho — só some da lista de pendentes quando você marca como
  recebido/pago.
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
    pagamento mensal. Sem busca, a tela mostra o histórico geral organizado em três
    categorias (três botões no topo: "Recebido de alunos", "Pago a professores", "Pago
    em despesas"), cada uma agrupada mês a mês com o subtotal de cada mês, do mais
    recente para o mais antigo. Cada item do histórico geral tem um botão **"Excluir"**,
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

---

## 6. Solução de problemas

- **"Cannot find module 'node:sqlite'" ou erro parecido ao iniciar** — a versão do
  Node em uso é anterior à 22.5. Confira em Settings do serviço (Railway/Render) se dá
  para fixar a versão do Node, ou adicione um arquivo `.node-version` na raiz do
  projeto contendo `22` para ajudar o serviço a escolher a versão certa.
- **Perdi os dados depois de publicar uma atualização** — o volume/disco persistente
  não foi configurado (passo "d" acima), ou o `DATA_DIR` não bate com o caminho onde
  ele foi montado.
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

## 7. Estrutura do projeto

```
server/           todo o backend (servidor, banco de dados, regras de negócio, rotas)
  db.js             conexão com o SQLite e criação das tabelas
  services.js        regras de negócio: quinzenas, conflitos, faturas, recorrência
  auth.js            login/senha/sessão
  router.js          roteador HTTP simples (sem framework)
  routes/            um arquivo por área (alunos, professores, agendamento, pagamentos)
  index.js           ponto de entrada — inicia o servidor
public/            todo o frontend (HTML/CSS/JS puro, sem build)
  index.html         estrutura principal do site (depois do login, para a secretaria)
  login.html         tela de login
  professor.html     área exclusiva de cada professor logado
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
