import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { TradeEntry } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TradesTableProps {
  trades: TradeEntry[];
}

const TradesTable = ({ trades }: TradesTableProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <h3 className="text-lg font-semibold mb-4">Trade Log</h3>
      <ScrollArea className="h-[300px]">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Time</TableHead>
              <TableHead className="text-muted-foreground">Ticker</TableHead>
              <TableHead className="text-muted-foreground">Type</TableHead>
              <TableHead className="text-muted-foreground text-right">Shares</TableHead>
              <TableHead className="text-muted-foreground text-right">Price</TableHead>
              <TableHead className="text-muted-foreground text-right">Balance</TableHead>
              <TableHead className="text-muted-foreground">Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade, index) => (
              <TableRow key={index} className="border-border">
                <TableCell className="font-mono text-sm">
                  {new Date(trade.timestamp).toLocaleString()}
                </TableCell>
                <TableCell className="font-semibold">{trade.ticker}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {trade.type === "BUY" ? (
                      <ArrowUpRight className="h-4 w-4 text-success" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4 text-destructive" />
                    )}
                    <span
                      className={
                        trade.type === "BUY"
                          ? "text-success"
                          : "text-destructive"
                      }
                    >
                      {trade.type}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {trade.shares.toFixed(1)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  ${trade.price.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  ${trade.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {trade.close_reason || "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </motion.div>
  );
};

export default TradesTable;
