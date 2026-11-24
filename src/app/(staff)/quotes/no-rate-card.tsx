import { Card, CardContent } from "@/components/ui/card";

export function NoRateCard() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        There is no active rate card yet. A Super Admin imports the booking workbook or activates a rate card first.
      </CardContent>
    </Card>
  );
}
