import requests, json, sys
sys.stdout.reconfigure(encoding="utf-8")
B="https://api.tcgdex.net/v2/en"
IDS = """swsh11-079 swsh11-050 swsh11-070 swsh11-118 sv06.5-038 swsh11-130 swsh11-131 swsh10-046 swsh9-041
swsh11-155 sv04.5-084 swsh11-163 sv08.5-101 sv04.5-076 swsh10-154 sv01-194 dv1-20 me01-114 swsh10-150 sv10.5b-084 sv08.5-126 sv08.5-119 sv02-190
ex16-105 ex16-107 ex16-103 ex16-104 ex16-106
sv03.5-004 sv03.5-005 sv03-125 sv03.5-016 sv03.5-017 sv03-164 sv01-191 sv04.5-091 sv01-166 sv01-189 sv02-185
sv01-081 sv04-070 swsh9-048 sv01-170""".split()
def g(u):
    for _ in range(5):
        try:
            r=requests.get(u,timeout=40)
            if r.status_code==200: return r.json()
        except Exception: pass
out={}
for i in IDS:
    c=g(f"{B}/cards/{i}")
    if not c: print("MISSING",i); continue
    def wk(l): return [{"type":x["type"],"value":x.get("value","×2")} for x in (l or [])]
    out[i]=dict(id=i,name=c["name"],cat=c["category"],stage=c.get("stage"),evolveFrom=c.get("evolveFrom"),hp=c.get("hp"),types=c.get("types"),
        retreat=c.get("retreat"),weak=[x["type"] for x in c.get("weaknesses") or []],resist=[x["type"] for x in c.get("resistances") or []],
        abilities=c.get("abilities") or [],attacks=c.get("attacks") or [],trainerType=c.get("trainerType"),energyType=c.get("energyType"),
        effect=c.get("effect"),rarity=c.get("rarity"),suffix=c.get("suffix"),set=c["set"]["name"],img=(c.get("image") or "")+"/high.webp",
        dexId=c.get("dexId"))
    x=out[i]; print("==",i,x["name"],x["cat"],x["stage"],x["hp"],x["types"],"retreat",x["retreat"],"weak",x["weak"],"suffix",x["suffix"],"img",bool(c.get("image")))
json.dump(out,open("data/cards.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
