# Sistema de Reforço Escolar

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
- **Ative os backups automáticos da Railway** como uma segunda camada de segurança: na
  aba **Settings** do serviço → **Backups**, dá para ligar backup diário/semanal/mensal
  do Volume com um clique — é a forma mais simples de conseguir restaurar os dados caso
  algo dê errado (seja um erro seu, seja algo da plataforma).

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
- **Backups**: os dados moram no volume, e o mais simples é ligar os backups automáticos
  da própria Railway (Settings do serviço → aba **Backups** → escolher diário/semanal/
  mensal) — cobre justamente esse caso (arquivo SQLite dentro de um Volume) e permite
  restaurar pelo próprio painel se algo der errado. Para uma cópia rápida e manual na
  hora, dá também para abrir um terminal do serviço (Shell) e copiar o arquivo
  `data/sistema.db`.

---

## 5. Um tour rápido pelas funcionalidades

- **Alunos** — cadastro completo (nome, endereço, responsáveis, telefone). A caixa
  "Pagamento mensal" faz o aluno aparecer em **Pagamentos → Pagamentos especiais** em
  vez de na lista de cobrança por aula — as aulas dele continuam no calendário
  normalmente. O valor da mensalidade **não** é definido no cadastro: toda mensalidade
  nasce com R$ 0,00 e você define/edita o valor de cada mês diretamente em Pagamentos →
  Pagamentos especiais (clique em "Definir valor"). Na ficha do aluno: dados, calendário
  de aulas, notas e observações.
- **Professores** — cadastro com disciplinas e PIX. Também é possível dar a cada
  professor um **login próprio** (e-mail + senha, preenchidos por você no cadastro):
  com ele, o professor entra pelo mesmo endereço do site e cai numa área só dele
  (`/professor.html`), onde vê o valor a receber na quinzena atual (que atualiza sozinho
  conforme você agenda aulas para ele), o histórico de faturas, as próprias aulas
  marcadas, e preenche a própria disponibilidade. A disponibilidade é uma grade de
  Segunda a Domingo, das 8h às 20h — o professor (ou você, pelo cadastro dele) marca os
  horários livres clicando nos quadradinhos. Isso é só uma anotação; como pedido, não
  bloqueia nem avisa nada no agendamento. Na ficha do professor (lado da secretaria):
  dados, disponibilidade, calendário de aulas e o total de horas/valor de cada quinzena.
- **Agendamento** — ao marcar uma aula você escolhe aluno → modalidade → disciplina →
  professor (a lista de professores já vem filtrada pela disciplina escolhida) → data e
  horário → valores → link da aula. Há também uma opção de aula recorrente semanal
  ("acompanhamento"), que cria uma aula individual por semana no período escolhido.
  Conflitos de horário **avisam** ("⚠️ Foram identificados conflitos.") mas nunca
  bloqueiam o agendamento. Aulas canceladas somem de todos os cálculos e telas.
- **Pagamentos** — abas para "A receber" (aulas avulsas pendentes), "A pagar"
  (faturas quinzenais dos professores, geradas automaticamente ao fim de cada
  quinzena), "Pagamentos especiais" (mensalistas), "Despesas" (contas gerais) e
  "Histórico". Nada pendente desaparece sozinho — só some da lista de pendentes quando
  você marca como recebido/pago.

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
- **Esqueci a senha do administrador** — abra um terminal (Shell) no painel do serviço
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
  index.html         estrutura principal do site (depois do login)
  login.html         tela de login
  css/style.css      estilo visual
  js/                lógica de cada página + calendário + funções compartilhadas
```
