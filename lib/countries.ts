/** Country names as fairs list them (German or English) -> usual web domain ending. Pure; used in the browser too. */
export const COUNTRIES: Array<[RegExp, string]> = [
  [/^(deutschland|germany)$/, ".de"], [/^([öo]sterreich|austria)$/, ".at"], [/^(schweiz|switzerland|suisse|svizzera)$/, ".ch"],
  [/^(frankreich|france)$/, ".fr"], [/^(italien|italy|italia)$/, ".it"], [/^(spanien|spain|espa[ñn]a)$/, ".es"], [/^(polen|poland|polska)$/, ".pl"],
  [/^(niederlande|netherlands|nederland)$/, ".nl"], [/^(belgien|belgium|belgique)$/, ".be"], [/^(vereinigtes k[öo]nigreich|united kingdom|uk|gro[ßs]britannien|england|schottland|scotland)$/, ".co.uk"],
  [/^(vereinigte staaten|united states|usa|us)$/, ".com"], [/^portugal$/, ".pt"], [/^(tschechien|czech republic|czechia)$/, ".cz"], [/^(d[äa]nemark|denmark)$/, ".dk"],
  [/^(schweden|sweden)$/, ".se"], [/^(norwegen|norway)$/, ".no"], [/^(finnland|finland)$/, ".fi"], [/^(ungarn|hungary)$/, ".hu"], [/^(griechenland|greece)$/, ".gr"],
  [/^(irland|ireland)$/, ".ie"], [/^(luxemburg|luxembourg)$/, ".lu"], [/^(rum[äa]nien|romania)$/, ".ro"], [/^(kroatien|croatia)$/, ".hr"], [/^(slowenien|slovenia)$/, ".si"],
  [/^(slowakei|slovakia)$/, ".sk"], [/^(litauen|lithuania)$/, ".lt"], [/^(lettland|latvia)$/, ".lv"], [/^(estland|estonia)$/, ".ee"], [/^(bulgarien|bulgaria)$/, ".bg"],
  [/^(serbien|serbia)$/, ".rs"], [/^(ukraine)$/, ".ua"], [/^(kanada|canada)$/, ".ca"], [/^(australien|australia)$/, ".com.au"], [/^(neuseeland|new zealand)$/, ".co.nz"],
  [/^(japan)$/, ".co.jp"], [/^(republik korea|s[üu]dkorea|south korea|korea)$/, ".co.kr"], [/^(indien|india)$/, ".in"], [/^(brasilien|brazil)$/, ".com.br"],
  [/^(mexiko|mexico)$/, ".com.mx"], [/^(argentinien|argentina)$/, ".com.ar"], [/^(t[üu]rkei|turkey|t[üu]rkiye)$/, ".com.tr"], [/^(israel)$/, ".co.il"],
  [/^(singapur|singapore)$/, ".com.sg"], [/^(taiwan)$/, ".com.tw"], [/^(s[üu]dafrika|south africa)$/, ".co.za"], [/^(china|volksrepublik china)$/, ".cn"],
];
/** The usual web domain ending for a country name (German or English, as fairs list them). */
export const countryTld = (country?: string) => {
  const c = (country ?? "").trim().toLowerCase();
  return COUNTRIES.find(([re]) => re.test(c))?.[1];
};

/** The country entry a free-text name refers to ("Germany", "deutsche", "Deutschland"), if any. */
export function countryEntry(text: string): [RegExp, string] | undefined {
  const t = text.trim().toLowerCase().replace(/^(the )/, "");
  const adjectives: Record<string, string> = {
    german: "deutschland", deutsche: "deutschland", deutschen: "deutschland", french: "frankreich", französische: "frankreich", italian: "italien", italienische: "italien",
    spanish: "spanien", british: "united kingdom", english: "united kingdom", american: "united states", us: "united states", austrian: "österreich", swiss: "schweiz",
    dutch: "niederlande", polish: "polen", belgian: "belgien", portuguese: "portugal", czech: "tschechien", danish: "dänemark", swedish: "schweden",
    norwegian: "norwegen", finnish: "finnland", korean: "republik korea", japanese: "japan", chinese: "china", indian: "indien", canadian: "kanada",
  };
  const name = adjectives[t] ?? t;
  return COUNTRIES.find(([re]) => re.test(name));
}

/** Is a row's country (as the fair wrote it) the same country as the one asked for? */
export function sameCountry(rowCountry: string, asked: string): boolean {
  const e = countryEntry(asked);
  return e ? e[0].test(rowCountry.trim().toLowerCase()) : rowCountry.trim().toLowerCase() === asked.trim().toLowerCase();
}
