import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'

import { FC } from 'hono/jsx'
import assert from 'node:assert'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'path'
const app = new Hono()

export type Todo = {
  isDone: boolean,
  body: string,
  priority: string,
  contexts: string[],
  tags: string[],
  attributes: { key: string, value: string }[]
}

function parseTodo(line: string): Todo | undefined {
  //@ts-ignore
  const structRegex = /^(?<done>[xX]?\ *)(?:\((?<priority>[A-Z])\)\ )?(?<body>.+)\ ?/gi

  const contextRegex = /\@\w+/gmi
  const tagsRegex = /\+\w+/gmi
  //@ts-ignore
  const attributesRegex = /(?<key>\w+)\:(?<value>[\w\-\_]+)/gmi

  const parsedTodo = structRegex.exec(line)?.groups

  if (!parsedTodo) return undefined;

  const contexts = parsedTodo.body.matchAll(contextRegex).toArray().map(a => a[0].substring(1))
  const tags = parsedTodo.body.matchAll(tagsRegex).toArray().map(a => a[0].substring(1))
  const attributes = parsedTodo.body.matchAll(attributesRegex).toArray().map(a => a.groups) as { key: string, value: string }[]

  return {
    isDone: parsedTodo.done ? true : false,
    body: parsedTodo.body.replaceAll(attributesRegex, ""),
    priority: parsedTodo.priority,
    contexts: contexts,
    tags: tags,
    attributes: attributes || []
  }
}
function serialiseTodo(todo: Todo) {

  return `${todo.isDone ? "x " : ""}${todo.priority ? `(${todo.priority}) ` : ""}${todo.body}${todo.attributes.map(a => ` ${a.key}:${a.value}`).join("")}`
}
const todoPath = join(Bun.env.HOME || "/", "todo", "busch", "todo.txt")
const donePath = join(Bun.env.HOME || "/", "todo", "busch", "done.txt")

let todos: Todo[] = []
function loadTodos() {
  const fileContents = readFileSync(todoPath).toString()

  const lines = fileContents.split("\n").filter(Boolean)
  todos = lines.map(l => parseTodo(l)).filter(Boolean).sort((a, b) => {
    assert(a)
    assert(b)

    return (a.priority || "Z").localeCompare(b.priority || "Z")
  }) as Todo[]
}

function saveTodos() {
  const fileContents = todos.map(t => serialiseTodo(t)).join("\n") + "\n"

  writeFileSync(todoPath, fileContents)
}

function dumpToDone(todos: Todo[]) {
  const done = readFileSync(donePath).toString()
  const fileContents = todos.map(t => serialiseTodo(t)).join("\n") + "\n" + done
  writeFileSync(donePath, fileContents)

}

export const TodoRow: FC<{ todo: Todo }> = ({ todo }) => {
  const vals = JSON.stringify({ body: todo.body, priority: todo.priority })
  const figmaLink = todo.attributes.find(a => a.key = "figma")?.value
  return <tr class="todo">
    <td style={"width: 2rem"}>
      <input type="checkbox"
        name="shouldBeDone"
        hx-vals={vals}
        hx-post="/toggle-done"
        hx-target="closest .todo"
        hx-swap="outerHTML"
        checked={todo?.isDone} />
    </td>
    <td style={"width: 3rem"}>
      <select name="newPriority" hx-vals={vals} hx-post="/set-priority" hx-target="body">
        <option value="">-</option>
        {"ABCDEFGHIJKLMNOP".split("").map(char => <option
          value={char}
          selected={char == todo?.priority}>{char}</option>)}
      </select></td>
    <td >
      <textarea style={"border:0;width:100%; height:100%;" + (todo.isDone ? "text-decoration: line-through" : "")}
        hx-trigger="change"
        hx-post="/update-body"
        hx-swap="outerHTML"
        hx-vals={vals}
        name="newBody"
        hx-target="closest .todo" >
        {todo?.body}
      </textarea></td>
    {figmaLink ?
      <td hx-vals={vals}
        hx-prompt="Enter figma link"
        hx-target="closest .todo"
        hx-swap="outerHTML"
        hx-post="/add-figma"
        hx-trigger="contextmenu"
        style="width: 8rem;">
        <a
          class="btn btn-outline-primary border-0 m-1"
          href={'https://www.figma.com/design/zNVxc3pmP7T96YecpR6TJS/Busch-Protective?node-id=' + figmaLink}
          target="_blank">Open <i class="bi bi-link"></i></a>
      </td>
      :
      <td style={"width: 8rem"}>
        <button
          type="button"
          hx-vals={vals}
          class="btn btn-outline-primary border-0 m-1"
          hx-prompt="Enter figma link"
          hx-target="closest .todo"
          hx-swap="outerHTML"
          hx-post="/add-figma">
          Add <i class="bi bi-plus"></i>
        </button></td>}
  </tr>
}
app.use(
  '*',
  basicAuth({
    username: 'taskmaster',
    password: Bun.env.TASKMAN_PASSWORD || "todo",
  })
)

app.post('/set-priority', async (c) => {
  const body = await c.req.parseBody();
  assert(typeof body.newPriority == "string")
  const nextTodos = todos.map(t => {
    if (t.body == body.body && t.priority == body.priority) return {
      ...t, priority: body.newPriority as string
    }
    return t
  })
  todos = nextTodos
  saveTodos()

  return c.redirect("/")

})
app.post('/add-figma', async (c) => {
  const body = await c.req.parseBody();
  const figmaLink = c.req.header("HX-Prompt")
  assert(figmaLink)
  const url = new URL(figmaLink)
  const figmaNodeId = url.searchParams.get("node-id")

  assert(typeof figmaNodeId == "string")
  let nextTodo: Todo | undefined;

  const nextTodos = todos.map(t => {
    if (t.body == body.body && t.priority == body.priority) {

      nextTodo = {
        ...t, attributes: [...t.attributes.filter(a => a.key != "figma"), { key: "figma", value: figmaNodeId }]
      }
      assert(nextTodo)
      return nextTodo
    }
    return t
  })
  assert(nextTodo)
  todos = nextTodos
  saveTodos()

  return c.html(<TodoRow todo={nextTodo} />)

})



app.post('/update-body', async (c) => {
  const body = await c.req.parseBody();
  assert(typeof body.newBody == "string")
  let nextTodo: Todo | undefined;

  const nextTodos: Todo[] = todos.map(t => {
    if (t.body == body.body && t.priority == body.priority) {

      nextTodo = parseTodo(serialiseTodo({
        ...t, body: body.newBody as string
      }))
      assert(nextTodo)

      return nextTodo;
    }
    return t
  })
  assert(nextTodo)
  todos = nextTodos
  saveTodos()
  return c.html(<TodoRow todo={nextTodo} />)

})


app.post('/cleanup', async (c) => {
  const nextTodos = todos.filter(t => !t.isDone)
  const doneTodos = todos.filter(t => t.isDone)
  dumpToDone(doneTodos)
  todos = nextTodos
  saveTodos()

  return c.redirect("/")

})

app.post('/toggle-done', async (c) => {
  const body = await c.req.parseBody();
  let nextTodo: Todo | undefined;
  const nextTodos = todos.map(t => {
    if (t.body == body.body && t.priority == body.priority) {

      nextTodo = {
        ...t, isDone: body.shouldBeDone ? true : false
      }
      return nextTodo
    }
    return t
  })
  assert(nextTodo)
  todos = nextTodos
  saveTodos()

  return c.html(<TodoRow todo={nextTodo} />)

})
app.post('/add', async (c) => {
  const body = await c.req.parseBody();
  assert(typeof body.Forderung == "string")
  const newTodo = parseTodo(body.Forderung)
  assert(newTodo)
  todos = [...todos, newTodo]
  saveTodos()

  console.log(todos)
  return c.redirect("/")

})
app.get('/', (c) => {
  loadTodos()
  saveTodos()

  const searchFilter = c.req.query("q")

  return c.html(<html>
    <head>
      <title>taskman v0.0.1</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta charset="utf-8" />
      <link rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@materialstyle/materialstyle@3.1.1/dist/css/materialstyle.min.css"
        integrity="sha384-TveZ4SBMG9Zwu44Pq5aK2bgL+4CaFRTtx6pSSsxmQKWhIRKoONDSRW+k+NA9A0Gk"
        crossorigin="anonymous"></link>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" integrity="sha384-tViUnnbYAV00FLIhhi3v/dWt3Jxw4gZQcNoSCxCIFNJVCx7/D55/wXsrNIRANwdD" crossorigin="anonymous"></link>
    </head>
    <body>
      <div class="d-flex px-2 py-4 position-fixed top-0 left-0 bg-white w-100 z-3">


        <div class="form-floating-with-icon">
          <div class="form-floating form-floating-outlined">
            <input type="search" class="form-control" id="search" name="q" hx-get="/" hx-target="body"
              placeholder="Filter..." autocomplete="off" value={searchFilter} />
            <label for="search">Filter...</label>
          </div>
          <span class="prepend">
            <i class="bi bi-filter"></i>
          </span>
        </div>

        <button type="button" hx-post="/cleanup" hx-target="body" class="btn btn-outline-primary border-0 m-1 flex-shrink-0">
          Archive done <i class="bi bi-archive"></i>
        </button>
      </div>
      <div class="px-2" style={"padding-top: 80pt"}>
        <table class="table">
          <thead>
            <tr>
              <th>Erledigt</th>
              <th>Priorität</th>

              <th>Forderung</th>
              <th>Figma-Link</th>

            </tr>
          </thead>
          <tbody>
            {todos.filter(todo => {
              if (searchFilter) {
                if (searchFilter.length == 1) {

                  return todo.priority == searchFilter.toUpperCase()
                }
                return todo.body.toLocaleLowerCase().includes(searchFilter.toLocaleLowerCase())
              }
              return true
            }).map(todo =>
              <TodoRow todo={todo} />
            )}
            <tr><td colspan={4}>
              <div class="form-floating form-floating-outlined">
                <input type="text" name="Forderung" hx-post="/add" hx-target="body" hx-trigger="keyup[key=='Enter']" class="form-control" id="newtodo"
                  placeholder="Forderung...." autocomplete="off" />
                <label for="newtodo">Forderung hinzufügen</label>
              </div>
            </td>
            </tr>
          </tbody>
        </table></div>
      <script src="https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.8/dist/umd/popper.min.js"
        integrity="sha384-I7E8VVD/ismYTF4hNIPjVp/Zjvgyol6VFvRkX/vR+Vc4jQkC+hVqc2pM8ODewa9r"
        crossorigin="anonymous"></script>

      <script src="https://cdn.jsdelivr.net/npm/@material/ripple@14.0.0/dist/mdc.ripple.min.js"
        integrity="sha384-9QANVmWxL3S8VRs8x1Q+bF1Zzogpy7P/Qw1+y5qHLdC1ig0EuoHg9VbB1SXyecdZ"
        crossorigin="anonymous"></script>

      <script src="https://cdn.jsdelivr.net/npm/@materialstyle/materialstyle@3.1.1/dist/js/materialstyle.min.js"
        integrity="sha384-rqhP61M9WSmzd7+ssgyoWP2I+R68vVHx7o+UmmIs6/Nxe8Lt1DoF6+0CKptZIXC0"
        crossorigin="anonymous"></script>
      <script dangerouslySetInnerHTML={{
        __html: `
        var textFieldList = [].slice.call(document.querySelectorAll('.form-control'))
var textFields = textFieldList.map(function (textField) {
  return new materialstyle.TextField(textField)
})


        `}} ></script>
      <script src="https://unpkg.com/htmx.org@2.0.4"></script>

    </body></html>)
})
loadTodos()

export default app
