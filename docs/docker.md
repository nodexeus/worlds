# Running with Docker Compose

Install Docker with the Compose plugin (Docker Desktop includes both), then run from
the repository root:

```bash
docker compose up --build -d --wait
```

Open <http://localhost:5274>. The image builds the frontend and runs the existing Node
server as a non-root user. Only the local machine can connect to the published port.
To use another port, run `BOT_CROSSING_PORT=5275 docker compose up --build -d --wait`.

```bash
docker compose logs -f       # View server logs
docker compose down          # Stop; keep your colony
```

The `colony-data` named volume keeps `/app/data/colony.json` across rebuilds and container
recreation. `docker compose down --volumes` deletes that saved colony. A native installation's
existing `data/colony.json` is not automatically imported. After editing app code, rerun
the build command; this configuration serves a built app and does not hot-reload.

## Reading your sessions

Compose mounts `${HOME}/.codex` and `${HOME}/.claude` read-only by default. Set `CODEX_HOME`
or `CLAUDE_CONFIG_DIR` in your shell or a local `.env` file to use different source directories.
No session data is copied into the image. Remove the corresponding bind entry from
`docker-compose.yml` if a harness is not installed. The source directories must exist and
be readable by the container's `node` user (UID 1000); on Linux, override the service's
`user` with your host UID:GID if necessary and ensure the data volume is writable by it.
On Windows, replace sources with absolute host paths if `HOME` is unset.

Claude desktop sessions need a separate mount. On macOS, create `compose.override.yaml`
beside `docker-compose.yml` with the following content. Compose loads it automatically.
Choose `Claude` instead of `Claude-3p` if that is where your installation stores sessions:

```yaml
services:
  bot-crossing:
    volumes:
      - type: bind
        source: ${HOME}/Library/Application Support/Claude-3p/claude-code-sessions
        target: /home/node/.config/Claude/claude-code-sessions
        read_only: true
        bind:
          create_host_path: false
```

Rerun `docker compose up -d --wait` after changing mounts. Other harnesses can use the same
read-only bind pattern with their paths or environment overrides from
[`server/harnesses/`](../server/harnesses/).

If sessions appear to be missing, check **Settings → Hide dormant repos**. It hides a repo
when all its sessions have been quiet for three days, even when the session mounts work.
Turn it off to show those repos. Claude desktop metadata also needs the separate mount
above to preserve desktop titles and unread status; mounting only `.claude` reads CLI
transcripts without that metadata.

The container cannot open your host's desktop apps, terminals, or repository folders.
Host process detection is also unavailable. Compose sets `BOT_CROSSING_CLAUDE_ACTIVITY=transcript`
so Claude activity and subagents can be inferred from recent transcript writes: a user
turn or tool call indicates work, and an assistant reply indicates waiting for you.
After five minutes without transcript writes, that activity signal expires. A killed
session may look busy until then, and a quiet tool running longer than five minutes may
look idle. Native runs keep the stricter live-process check unless you explicitly set
this variable. Run natively with `npm run dev` for host process and desktop integrations.

See the [Compose service reference](https://docs.docker.com/reference/compose-file/services/)
for bind-mount and port options.
