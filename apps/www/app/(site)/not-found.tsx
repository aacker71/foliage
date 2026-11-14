import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-24">
      <p className="font-display text-3xl text-foreground">Foliage</p>
      <h1 className="mt-6 text-balance font-display text-4xl text-foreground">
        Page not found
      </h1>
      <p className="mt-6 text-base leading-relaxed text-muted-foreground">
        This address does not lead to a page. Return to Foliage to continue.
      </p>
      <Button className="mt-10 min-h-11" asChild>
        <Link href="/">Return to Foliage</Link>
      </Button>
    </main>
  );
}
