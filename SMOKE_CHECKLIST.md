# Smoke check — parcours cœur (1 page)

À dérouler avant chaque release, sur le binaire installé (pas le dev server).

1. **Premier lancement** : le wizard s'affiche, « Charger les decks démo » crée 4 decks.
2. **Accueil** : le héros affiche « N cartes à réviser » > 0 et « Réviser maintenant » lance une session.
3. **Session** : plein écran (pas de sidebar), Espace retourne la carte, 1-4 notent,
   les intervalles s'affichent sous les boutons, « Encore » fait revenir la carte
   plus tard dans la même session, Échap demande confirmation après 5 cartes.
4. **Fin de session** : récap (cartes/précision/durée), « Continuer » propose le reste dû.
5. **Créer** : onglet IA (erreur claire sans clé), Capture OCR reconnaît une image,
   onglet Importer accepte un .apkg.
6. **Statistiques** : la review de l'étape 3 apparaît dans « Étudiées aujourd'hui »
   et la heatmap ; le streak du jour s'incrémente (vérifier après minuit LOCAL si doute).
7. **Paramètres** : changer le thème persiste après relance ; activer « Saisie de la
   réponse » + « Évaluation de confiance » → la session montre le champ de réponse
   et le strip de confiance AVANT le flip.
8. **Backup** : Données → Tout exporter → réimporter sur base vierge → les états
   FSRS et l'historique sont conservés (deck non « neuf »).
