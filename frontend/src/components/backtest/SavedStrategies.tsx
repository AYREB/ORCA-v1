import { useState } from "react";
import { motion } from "framer-motion";
import { Bookmark, Trash2, Clock, TrendingUp, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { SavedStrategy } from "@/lib/api";

interface SavedStrategiesProps {
  strategies: SavedStrategy[];
  onSelect: (strategy: SavedStrategy) => void;
  onDelete?: (id: number) => Promise<void> | void;
  selectedId?: number | null;
}

const SavedStrategies = ({ strategies, onSelect, onDelete, selectedId }: SavedStrategiesProps) => {
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    try {
      setDeletingId(id);
      await onDelete?.(id);
      toast.success("Strategy deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete strategy";
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (value: string) => {
    try {
      return new Date(value).toLocaleDateString();
    } catch {
      return value;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="p-6 rounded-xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
          <Bookmark className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Saved Strategies</h3>
          <p className="text-sm text-muted-foreground">{strategies.length} strategies saved</p>
        </div>
      </div>

      <ScrollArea className="h-[300px] pr-4">
        <div className="space-y-3">
          {strategies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bookmark className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No saved strategies yet</p>
              <p className="text-sm">Save a strategy to see it here</p>
            </div>
          ) : (
            strategies.map((strategy) => {
              const totalReturn = strategy.lastResult?.pct_change ?? null;
              return (
                <div
                  key={strategy.id}
                  className={`p-4 rounded-lg border transition-all cursor-pointer ${
                    selectedId === strategy.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 bg-secondary/30"
                  }`}
                  onClick={() => onSelect(strategy)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h4 className="font-medium flex items-center gap-2">
                        {strategy.name}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </h4>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>Created {formatDate(strategy.createdAt)}</span>
                      </div>
                    </div>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(e) => e.stopPropagation()}
                          disabled={deletingId === strategy.id}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Strategy</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{strategy.name}"? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(strategy.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  {totalReturn !== null && (
                    <div className="flex items-center gap-2 mt-3">
                      <Badge
                        variant={totalReturn >= 0 ? "default" : "destructive"}
                        className="text-xs"
                      >
                        <TrendingUp className="h-3 w-3 mr-1" />
                        {totalReturn >= 0 ? "+" : ""}
                        {totalReturn.toFixed(2)}%
                      </Badge>
                      {strategy.lastRun && (
                        <Badge variant="secondary" className="text-xs">
                          Last run {formatDate(strategy.lastRun)}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </motion.div>
  );
};

export default SavedStrategies;
