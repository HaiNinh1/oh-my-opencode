import json, os, time

DIR = os.path.expanduser("~/.config/opencode/prompt-dumps")
os.makedirs(DIR, exist_ok=True)

def request(flow):
    if flow.request.method != "POST":
        return
    try:
        body = json.loads(flow.request.content)
    except Exception:
        return
    ts = time.strftime("%Y-%m-%dT%H-%M-%S")
    host = flow.request.pretty_host
    path = flow.request.path.replace("/", "_")
    name = f"{host}{path}-{ts}.json"
    with open(os.path.join(DIR, name), "w") as f:
        json.dump(body, f, indent=2)