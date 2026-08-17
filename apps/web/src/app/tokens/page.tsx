import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { BRANCH_META, SECTOR_LABEL } from "@borsoga/shared";

/**
 * Página de verificación de tokens. No es una pantalla del producto: existe
 * para comprobar que los seis temas se pintan bien y que los componentes de
 * shadcn heredan el diseño a través del puente de globals.css.
 *
 * Las siete pantallas reales se construyen a partir de aquí.
 */

const SURFACES = [
  { name: "--bg", cls: "bg-background" },
  { name: "--panel", cls: "bg-panel" },
  { name: "--card", cls: "bg-card" },
  { name: "--card2", cls: "bg-card2" },
  { name: "--inset", cls: "bg-inset" },
  { name: "--chip", cls: "bg-chip" },
  { name: "--hover", cls: "bg-hover" },
  { name: "--input", cls: "bg-field" },
];

const TEXTS = [
  { name: "--text", cls: "text-foreground" },
  { name: "--text2", cls: "text-text2" },
  { name: "--muted", cls: "text-muted-foreground" },
  { name: "--dim", cls: "text-dim" },
  { name: "--dim2", cls: "text-dim2" },
  { name: "--dim3", cls: "text-dim3" },
];

const STATUS = [
  { name: "--crit", cls: "bg-crit" },
  { name: "--warn", cls: "bg-warn" },
  { name: "--ok", cls: "bg-ok" },
  { name: "--accent", cls: "bg-brand" },
];

const SCALE = [
  ["9,5", "text-2xs"], ["10", "text-xs"], ["10,5", "text-xs2"],
  ["11", "text-sm"], ["11,5", "text-sm2"], ["12", "text-base"],
  ["12,5", "text-base2"], ["13", "text-md"], ["13,5", "text-md2"],
  ["14", "text-lg"], ["15", "text-xl"], ["15,5", "text-xl2"],
  ["17", "text-2xl"], ["19", "text-3xl"], ["21", "text-4xl"],
  ["23", "text-5xl"], ["27", "text-6xl"],
] as const;

function Section({ title, note, children }: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 border-b border-line pb-2">
        <h2 className="text-md font-medium">{title}</h2>
        {note && <p className="text-sm text-dim">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function TokensPage() {
  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="flex h-[52px] flex-none items-center gap-4 border-b border-line bg-panel px-4">
        <div className="flex flex-none items-center gap-2.5">
          <div className="grid h-[25px] w-[25px] place-items-center rounded-[7px] bg-brand text-xs2 font-bold text-brand-ink">
            B
          </div>
          <span className="text-md whitespace-nowrap">
            <span className="text-muted-foreground">Borsoga</span>
            <span className="mx-1.5 text-dim3">/</span>
            <span className="font-medium">Prospector</span>
          </span>
        </div>
        <span className="text-sm text-dim">Verificación de tokens</span>
        <div className="ml-auto">
          <ThemeSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 p-8">
        <Section title="Superficies" note="claro y oscuro, los seis acentos">
          <div className="grid grid-cols-4 gap-3">
            {SURFACES.map((s) => (
              <div key={s.name} className="overflow-hidden rounded-lg border border-line">
                <div className={`h-14 ${s.cls}`} />
                <div className="border-t border-line bg-panel px-2.5 py-1.5 font-mono text-xs text-dim">
                  {s.name}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Texto"
          note="--dim y --dim2 llevan los metadatos de evidencia: han de superar 4,5:1"
        >
          <Card className="gap-0 space-y-1.5 bg-card p-4">
            {TEXTS.map((t) => (
              <p key={t.name} className={`text-base2 ${t.cls}`}>
                <span className="font-mono text-xs">{t.name}</span>
                <span className="mx-2 text-dim3">·</span>
                Capturado el 14/08/2026 · navegador real 1440×900 · served_html
              </p>
            ))}
          </Card>
        </Section>

        <Section title="Severidad y estado">
          <div className="flex gap-3">
            {STATUS.map((s) => (
              <div key={s.name} className="flex-1 overflow-hidden rounded-lg border border-line">
                <div className={`h-10 ${s.cls}`} />
                <div className="bg-panel px-2.5 py-1.5 font-mono text-xs text-dim">{s.name}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Ramas" note="nunca más colores que estos tres más severidad">
          <div className="flex gap-3">
            {(Object.keys(BRANCH_META) as Array<keyof typeof BRANCH_META>).map((b) => {
              const meta = BRANCH_META[b];
              const bg =
                b === "renders" ? "bg-branch-renders"
                : b === "web" ? "bg-branch-web"
                : "bg-branch-branding";
              return (
                <Card key={b} className="flex-1 gap-0 space-y-2 bg-card p-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${bg}`} />
                    <span className="text-base2 font-medium">{meta.label}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs text-dim">
                    <span>{meta.letter}</span>
                    <span>{meta.token}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>

        <Section title="Escala tipográfica" note="la real del prototipo, sin tamaños intermedios">
          <Card className="gap-0 space-y-1 bg-card p-4">
            {SCALE.map(([px, cls]) => (
              <div key={px} className="flex items-baseline gap-4">
                <span className="w-12 flex-none text-right font-mono text-xs text-dim">{px}</span>
                <span className={cls}>Deficiencias detectadas en la presencia digital</span>
              </div>
            ))}
          </Card>
        </Section>

        <Section title="Componentes shadcn" note="heredan el diseño por el puente de globals.css">
          <Card className="gap-4 bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm">Escanear zona</Button>
              <Button size="sm" variant="secondary">Generar propuesta</Button>
              <Button size="sm" variant="outline">Reverificar con IA</Button>
              <Button size="sm" variant="ghost">Descartar</Button>
              <Button size="sm" variant="destructive">Error de cuota</Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge>Encaje ICP</Badge>
              <Badge variant="secondary">Sin contactar</Badge>
              <Badge variant="outline">Descartados</Badge>
              <Badge variant="destructive">Crítico</Badge>
            </div>

            <Tabs defaultValue="mapa">
              <TabsList>
                <TabsTrigger value="mapa">Mapa</TabsTrigger>
                <TabsTrigger value="revision">Revisión</TabsTrigger>
                <TabsTrigger value="expediente">Expediente</TabsTrigger>
                <TabsTrigger value="traza">Traza</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-3">
              <Switch defaultChecked id="zona" />
              <label htmlFor="zona" className="text-base2 text-muted-foreground">
                Zona activa
              </label>
            </div>
          </Card>
        </Section>

        <Section title="Animaciones" note="solo estas; nada de animaciones de entrada en listas">
          <Card className="flex flex-row items-center gap-8 bg-card p-6">
            <div className="relative grid h-16 w-16 place-items-center">
              <span className="absolute h-[38px] w-[38px] rounded-full bg-brand/40 animate-pulse-ring" />
              <span className="relative z-10 grid h-[38px] w-[38px] place-items-center rounded-full bg-brand font-mono text-sm text-brand-ink">
                87
              </span>
            </div>

            <div className="relative h-16 w-40 overflow-hidden rounded-md border border-line2 bg-inset">
              <span className="absolute left-0 h-px w-full bg-brand animate-scan-y" />
              <span className="absolute h-2.5 w-2.5 rounded-full bg-brand/70 animate-crawl" />
            </div>

            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-inset">
              <span className="block h-full rounded-full bg-brand animate-bar" />
            </div>

            <svg width="120" height="40" className="flex-none">
              <line
                x1="4" y1="34" x2="116" y2="6"
                stroke="var(--accent)" strokeWidth="1.4"
                strokeDasharray="2 6" className="animate-ants"
              />
              <circle cx="116" cy="6" r="3" fill="var(--accent)" />
            </svg>

            <span className="font-mono text-sm text-muted-foreground">
              auditando<span className="animate-blink">▌</span>
            </span>
          </Card>
        </Section>

        <Section title="Sectores del ICP">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(SECTOR_LABEL).map(([key, label]) => (
              <Badge key={key} variant="secondary" className="font-normal">
                {label}
              </Badge>
            ))}
          </div>
        </Section>
      </main>
    </div>
  );
}
