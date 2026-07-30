import json

data = json.load(open('decks.json', encoding='utf-8'))
cards = data['decks'][0]['cards']

verbi_nonsense = ['Preferire', 'Mangiare', 'Cucinare', 'Ordinare', 'Preparare', 'Condire',
    'Usare', 'Aprire', 'Controllare', 'Scaricare', 'Disinstallare', 'Chiudere',
    'Comprare', 'Acquistare', 'Regalare', 'Mettere nel carrello', 'Spendere',
    'Fare', 'Praticare', 'Organizzare', 'Iniziare', 'Evitare', 'Provare',
    'Rinviare', 'Pianificare', 'Rimandare', 'Prenotare', 'Sognare', 'Cancellare',
    'Ignorare', 'Incontrare', 'Salutare', 'Cercare', 'Osservare', 'Parlare',
    'Incrociare', 'Delegare', 'Sostituire']

nonsense = [c for c in cards if any(c['prompt'].startswith(v) for v in verbi_nonsense)]
good = [c for c in cards if not any(c['prompt'].startswith(v) for v in verbi_nonsense)]

print(f"Carte totali: {len(cards)}")
print(f"Carte NONSENSE (verbi azione): {len(nonsense)}")
print(f"Carte BUONE (concetti singoli): {len(good)}")
print()
print("Esempi nonsense:")
for c in nonsense[:20]:
    print(f"  X  {c['prompt']}")
print()
print("Esempi buone:")
for c in good[:30]:
    print(f"  OK {c['prompt']}")
