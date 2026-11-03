# Min-handleliste

En enkel, mobiltilpasset handleliste med middagsinspirasjon og et ukesbudsjett på 500 kr.

## Bruk

Åpne `index.html` i en nettleser, eller publiser repositoryet med GitHub Pages og åpne lenken på iPhone. Appen krever ingen konto, abonnement eller eksterne tjenester.

Legg til varer fra kategoriene, juster antall og pris direkte i handlelisten, og kryss av varene etter hvert som du handler. Basisvarer som ris, pasta og olje kan legges til når du trenger dem, men føres ikke automatisk opp på handlelisten hver uke. Bruk middagsinspirasjonen for å legge ingredienser til for valgt antall personer.

## Lagring og priser

Handlelisten og egne varer lagres lokalt i nettleserens `localStorage` på enheten. Data synkroniseres ikke mellom telefoner og kan forsvinne dersom nettleserdata slettes. Prisene er redigerbare anslag og ikke oppdaterte butikkpriser.

## GitHub Pages

Velg **Settings → Pages** i GitHub, og publiser fra **main** og rotmappen (`/`). `index.html` må være med i denne grenen; uten denne filen viser Pages bare innholdet i README i stedet for appen. HTML, CSS, JavaScript og standardvarer ligger samlet i `index.html`, uten eksterne filstier eller datakall.

Når publiseringen er ferdig, åpne https://tom250914.github.io/Min-handleliste/ i Safari eller del lenken.
