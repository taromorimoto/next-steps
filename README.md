# next-steps

A Claude Code mod that shows, every time Claude finishes a task:

- **how long the task took**, start to finish, and
- **3–5 suggested next steps**, written by Opus from your request and Claude's answer. The steps Opus recommends are starred (★) and already checked. Pick any combination and press **Send selected** to send them as your next prompt.

```
✓ Done · took 3m 12s
Next steps (★ = recommended, pick one or more):
☑ ★ Run the tests in CI
☐ Update the README
☑ ★ Add logout
[ Send selected (2) ]  [ Close ]
```

The suggested steps follow the language of your request.

## Install

At the prompt of a terminal session:

```
/plugin install next-steps --marketplace taromorimoto/next-steps
```

Answer `y` to add the marketplace, then pick a scope (user scope keeps it on in every session).

From a shell:

```
claude plugin install next-steps --marketplace taromorimoto/next-steps
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `taromorimoto/next-steps`, then Add plugin.

## Language

By default (`auto`) the labels follow the language of your request: Finnish requests get Finnish labels, everything else English (a very short prompt falls back to your system locale). To fix the language, set the `language` option to `en` or `fi`, either in the `/config` menu or from a shell:

```
echo '{"language":"fi"}' | claude plugin configure next-steps@next-steps --values-stdin
```

The suggested steps always follow the language of your request.

## Where it shows

- **Claude Code terminal and desktop app:** in the band right above the prompt box. Where a surface draws transcript rows, it goes under the answer instead.
- Steps are numbered; on the terminal, press 1–5 to toggle one.
- Interrupted turns and subagent work show nothing.

## Cost

Each finished task makes one extra Opus call (low effort, up to 1024 output tokens) to write the suggestions.

## License

MIT
