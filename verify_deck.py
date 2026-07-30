import json, random

data = json.load(open('decks.json', encoding='utf-8'))
cards = data['decks'][0]['cards']

prompts = [c['prompt'] for c in cards]
unique = set(p.lower() for p in prompts)
print(f"Carte totali: {len(cards)}")
print(f"Prompts unici: {len(unique)}")
print(f"Duplicati: {len(cards) - len(unique)}")

# Esempio di 15 carte casuali
random.seed(42)
sample = random.sample(cards, 15)
print("\n15 carte di esempio:")
for c in sample:
    print(f"  - {c['prompt']}")
