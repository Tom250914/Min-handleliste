# Min-handleliste

En enkel, mobiltilpasset handleliste med middagsinspirasjon og et ukesbudsjett på 500 kr.

## Bruk

Åpne `index.html` i en nettleser, eller publiser repositoryet med GitHub Pages og åpne lenken på iPhone. Appen krever ingen brukerkonto. Handlelisten fungerer også uten tilgang til prisfilen.

Legg til varer fra kategoriene, juster antall og pris direkte i handlelisten, og kryss av varene etter hvert som du handler. Basisvarer som ris, pasta og olje kan legges til når du trenger dem, men føres ikke automatisk opp på handlelisten hver uke. Bruk middagsinspirasjonen for å legge ingredienser til for 1–8 personer.

Middagene bruker mengder per person, blant annet **150 g kjøtt/fisk, 75 g tørr pasta/ris og 15 ml olje**, ikke én kilo eller én hel pakke per ingrediens. Ingrediensene og mengdene vises før tillegging. Budsjettet gjelder beregnet forbruk; det avrundes ikke opp til hele butikkpakninger.

Beregningsenhetene for eksisterende pakkevarer holdes faste (for eksempel 500 g pasta, 12 egg og 8 tortillalefser). En kildepris på 30 kr for 1 kg pasta blir derfor 15 kr per 500 g i beregningen, mens den faktiske kildepakningen og pakkeprisen vises separat. Dermed endres ikke lagrede mengder når prisfilen lastes eller butikkens pakningsstørrelse er annerledes. Uten prisdata er både priser og pakningsforutsetninger anslag.

## Lagring og priser

Handlelisten og egne varer lagres fortsatt under **samme nøkkel, `min-handleliste-v1`**, i nettleserens `localStorage`. Eksisterende produkter, mengder, avkrysninger, budsjett og manuelle priser beholdes; gamle mengder endres ikke automatisk. Data synkroniseres ikke mellom telefoner og kan forsvinne dersom nettleserdata slettes.

Butikk, konkret produkt, faktisk pakningsstørrelse/pakkepris, normalisert enhetspris og dato for siste registrerte pris vises fra `data/prices.json`. Bare komplette priser med både prisdato og innhenting innen **48 timer** brukes som kildepris. Datoen er fra prisobservasjonen, ikke bare tidspunktet jobben kjørte. Manglende/utdatert kilde, manglende nøkkel eller utilgjengelig prisfil viser **«Pris ikke verifisert»**. Gamle kildeopplysninger kan fortsatt vises som historikk, men brukes ikke som aktuell butikkpris.

Kildepriser brukes bare for uendrede standardvarer. Eldre priser som avviker fra standarden regnes som manuelle. Nye manuelle prisendringer markeres eksplisitt og overstyres aldri av prisoppdateringer, heller ikke ved omlasting. Knappen **Bruk kildepris** i handlelisten lar deg frivillig bytte tilbake når en gyldig kilde finnes. Prisoppdateringene skriver aldri til localStorage.

## Daglig Kassalapp-oppdatering

Workflowen `.github/workflows/update-prices.yml` kjører daglig **05:23 UTC**, eller manuelt via **Actions → Oppdater butikkpriser → Run workflow**, bare på `main`. Ingen API-kall eller API-nøkler inngår i nettsiden.

1. Opprett tilgang hos [Kassalapp](https://kassal.app/api), og kontroller gjeldende bruksvilkår og kvote.
2. Legg nøkkelen i **Settings → Secrets and variables → Actions → New repository secret**, med navnet **`KASSALAPP_API_KEY`**. Ikke bruk repository variables, HTML, JSON, URL-parametere eller commit for nøkkelen.
3. Godkjenn konkrete butikkprodukter i `data/product-sources.json`. Filen er bevisst tom: ingen butikkpriser eller produkt-ID-er er oppdiktet. Hver kobling må inneholde intern vare-ID, Kassalapp-ID, eksakt API-produktnavn, eksakt butikknavn og faktisk pakningsinnhold. Interne ID-er `p1`–`p43` følger rekkefølgen i `initialProducts` i `index.html` (`p1` kylling, `p2` kjøttdeig, `p21` pasta, `p23` ris).
4. Kjør workflowen og kontroller prisfilen og Pages-publiseringen. Delvis dekning er tillatt; ukoblede varer vises som ikke verifisert.

Eksempel på **formatet**, ikke en verifisert produktkobling:

```json
{
  "version": 1,
  "products": [
    {
      "id": "p1",
      "productId": 123,
      "name": "ERSTATT MED EKSAKT PRODUKTNAVN FRA API",
      "store": "ERSTATT MED BUTIKKNAVN FRA API",
      "packageSize": { "amount": 400, "unit": "g" }
    }
  ]
}
```

Innhold må være sammenlignbart med appens beregningsenhet: g/kg for vekt, ml/l for volum og `piece`/`stk` for antall. Det gjettes ikke på tetthet, eggantall eller om en ferdigrett tilsvarer rått kjøtt. Endret produktidentitet eller pakningsstørrelse stopper oppdateringen til koblingen er kontrollert.

Oppdateringsskriptet bruker `GET https://kassal.app/api/v1/products/id/{id}`, Bearer-autentisering og responsens `data`. Det validerer `id`, `name`, `store.name`, `weight`, `weight_unit`, `current_price` og siste `price_history[].date/price`. Manglende prisdato eller avvik mellom siste observasjon og gjeldende pris avvises. Bare eksplisitt tillatte, offentlige felt skrives til prisfilen. Råkropp, nøkkel og request-headere logges ikke. Kall går sekvensielt med minst 1,1 sekund mellom produkter; HTTP 429/5xx forsøkes inntil tre ganger med 60 sekunders venting. Nettverkskall har 20 sekunders timeout og følger ikke omdirigeringer.

Kilden er [API-dokumentasjonen](https://kassal.app/api/docs) og [OpenAPI-spesifikasjonen](https://kassal.app/docs/api.json). Dokumentasjon/API var ikke direkte tilgjengelig fra utviklingsmiljøet (DNS-feil), og en live-autentisert respons er **ikke verifisert**. Feltene og detaljruten er også kontrollert mot den offentlig tilgjengelige Python-klientens `models.py` og `client.py` i `bendikrb/kassalappy`. Responsvalideringen må bekreftes ved første autentiserte kjøring; den feiler lukket ved avvik.

Uten nøkkel gjøres ingen API-kall; prisfilen merkes `missing-key`, og eventuelle tidligere observasjoner beholdes kun som ikke-verifisert historikk. Med nøkkel, men uten godkjente produktkoblinger, feiler jobben tydelig. Ved andre feil beholdes forrige prisfil uendret og blir automatisk ikke verifisert når 48-timersgrensen passeres.

Jobben kjører ikke på pull requests, bruker SHA-låste Actions og har bare nødvendige skrivetilganger til innhold og Pages. Kun `data/prices.json` publiseres via Contents API med `GITHUB_TOKEN`, deretter bestilles en eksplisitt Pages-bygging siden token-committer ikke automatisk utløser dette. Branch protection/rulesets kan kreve særskilt tillatelse for denne automatiske committen; feil rapporteres av Actions, ikke skjules.

## Tester

Kjør **`node --test`** med Node.js 22 eller nyere; ingen pakkeinstallasjon kreves. Testene dekker alle 30 middager for 1, 2 og 8 personer, enhetskonvertering, lagringskompatibilitet, manuelle priser, kildepriser, alder på prisdata, manglende nøkkel/offline, responsvalidering og retry ved kvote-/serverfeil. API-responser i testene er syntetiske, ikke verifiserte butikkpriser.

## GitHub Pages

Velg **Settings → Pages** i GitHub, og publiser fra **main** og rotmappen (`/`). `index.html`, `pricing.js` og `data/prices.json` må publiseres sammen. HTML, CSS og appens standardvarer ligger fortsatt i `index.html`; farger, kort, typografi og layout er uendret. Prisfilen er offentlig og skal aldri inneholde hemmeligheter. Ved direkte åpning som lokal fil kan nettleseren blokkere innlasting av JSON; da fungerer listen med ikke-verifiserte priser.

Når publiseringen er ferdig, åpne https://tom250914.github.io/Min-handleliste/ i Safari eller del lenken.
