import { Play, Pause, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface ReplayControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onReset: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  progress: number;
  onProgressChange: (progress: number) => void;
  currentDate: string;
  totalCandles: number;
  currentIndex: number;
}

const SPEED_OPTIONS = [1, 2, 5, 10, 50];

const ReplayControls = ({
  isPlaying,
  onPlayPause,
  onReset,
  speed,
  onSpeedChange,
  progress,
  onProgressChange,
  currentDate,
  totalCandles,
  currentIndex,
}: ReplayControlsProps) => {
  return (
    <div className="p-3 rounded-xl border border-border bg-card/80 backdrop-blur-sm mb-2">
      <div className="flex items-center gap-4">
        {/* Play/Pause Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onPlayPause}
          className={cn(
            "h-9 w-9 rounded-full transition-all",
            isPlaying
              ? "bg-primary/20 text-primary hover:bg-primary/30"
              : "bg-success/20 text-success hover:bg-success/30"
          )}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </Button>

        {/* Divider */}
        <div className="w-px h-6 bg-border" />

        {/* Speed Controls */}
        <div className="flex items-center gap-1">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-mono transition-all",
                speed === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-border" />

        {/* Progress Slider */}
        <div className="flex-1 flex items-center gap-3 min-w-[200px]">
          <Slider
            value={[progress]}
            onValueChange={(v) => onProgressChange(v[0])}
            min={0}
            max={100}
            step={0.1}
            className="flex-1"
          />
          <span className="text-xs font-mono text-muted-foreground w-16 text-right">
            {currentIndex + 1}/{totalCandles}
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-border" />

        {/* Current Date */}
        <span className="text-sm font-mono text-foreground min-w-[100px]">
          {currentDate}
        </span>

        {/* Reset Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onReset}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default ReplayControls;
