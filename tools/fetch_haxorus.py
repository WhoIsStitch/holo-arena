import requests, json, sys, urllib.parse
sys.stdout.reconfigure(encoding="utf-8")
B = "https://api.tcgdex.net/v2/en"
WANT = {  # id: expected name
 "sv10.5b-068": "Axew", "sv10.5b-069": "Fraxure", "sv10.5b-070": "Haxorus", "sv04.5-037": "Mimikyu", "sv08.5-004": "Budew",
 "sv08.5-058": "Cornerstone Mask Ogerpon ex", "sv06-141": "Bloodmoon Ursaluna ex",
 "sv01-196": "Ultra Ball", "sv01-181": "Nest Ball", "sv05-144": "Buddy-Buddy Poffin", "sv04.5-089": "Rare Candy", "sv04-160": "Counter Catcher",
 "sv06.5-061": "Night Stretcher", "sv08.5-106": "Earthen Vessel", "sv03-186": "Arven", "sv08.5-096": "Black Belt's Training", "sv07-133": "Crispin",
 "sv02-172": "Boss's Orders", "sv06-155": "Lana's Aid", "sv05-154": "Maximum Belt", "sv04-178": "Technical Machine: Evolution", "sv01-169": "Defiance Band",
 "sv02-171": "Artazon", "sv02-192": "Reversal Energy",
}
def g(u):
    for _ in range(5):
        try:
            r = requests.get(u, timeout=40)
            if r.status_code == 200: return r.json()
        except Exception: pass
cards = json.load(open("data/cards.json", encoding="utf-8"))
for i, nm in WANT.items():
    c = g(f"{B}/cards/{i}")
    if not c or c["name"].lower() != nm.lower():
        print("MISMATCH", i, nm, c and c["name"])
        if not c: continue
    cards[i] = dict(id=i, name=c["name"], cat=c["category"], stage=c.get("stage"), evolveFrom=c.get("evolveFrom"), hp=c.get("hp"), types=c.get("types"), retreat=c.get("retreat"),
        weak=[x["type"] for x in c.get("weaknesses") or []], resist=[x["type"] for x in c.get("resistances") or []], abilities=c.get("abilities") or [], attacks=c.get("attacks") or [],
        trainerType=c.get("trainerType"), energyType=c.get("energyType"), effect=c.get("effect"), rarity=c.get("rarity"), suffix=c.get("suffix"), set=c["set"]["name"], img=(c.get("image") or "") + "/high.webp")
    x = cards[i]
    print("==", i, x["name"], x["cat"], x["stage"], x["hp"], x["types"], "retreat", x["retreat"], "weak", x["weak"], "suffix", x["suffix"], "img", bool(c.get("image")))
    for a in x["abilities"]: print("  AB", a["name"], "|", a["effect"])
    for a in x["attacks"]: print("  AT", a["name"], a.get("cost"), a.get("damage"), "|", a.get("effect"))
    if x["effect"]: print("  EF", x["effect"].replace("\n", " / "))
json.dump(cards, open("data/cards.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# basic energies with real images
for t in ["Fighting", "Metal"]:
    l = g(f"{B}/cards?name={urllib.parse.quote(t + ' Energy')}") or []
    print(t, [c["id"] for c in l if c["name"] == t + " Energy" and c.get("image")][:12])
