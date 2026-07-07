import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, ChevronsUpDown, ArrowLeftRight, Calculator, GripVertical } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { getParamDomain, clampToDomain } from "@/lib/paramDomains";
import IndicatorCommandPalette from "./IndicatorCommandPalette";
import {
  ConditionSide,
  SingleCondition,
  ConditionGroup,
  Registry,
  INDICATOR_META,
  generateId,
} from "./backtest-types";

// ── Helpers ──────────────────────────────────────────────────

const formatSideLabel = (side: ConditionSide): string => {
  if (side.type === "value") {
    let base = String(side.value);
    if (side.operation) base = `${base}${side.operation.operator}${side.operation.operand}`;
    return base;
  }
  const args = Object.entries(side.args).filter(([k]) => k !== "offset");
  const argVals = args.map(([, v]) => v);
  let base = argVals.length > 0 ? `${side.func}(${argVals.join(", ")})` : side.func;
  if (side.operation) base = `${base}${side.operation.operator}${side.operation.operand}`;
  return base;
};

const generateLogicPreview = (conditions: SingleCondition[]): string => {
  if (conditions.length === 0) return "";
  const groups = computeVisualGroups(conditions);
  const groupStrings = groups.map((group) => {
    const condStrings = group.map(
      (c) => `${formatSideLabel(c.left)} ${c.operator} ${formatSideLabel(c.right)}`
    );
    return group.length > 1 ? `(${condStrings.join(" AND ")})` : condStrings[0];
  });
  return groupStrings.join(" OR ");
};

const computeVisualGroups = (conditions: SingleCondition[]): SingleCondition[][] => {
  if (conditions.length === 0) return [];
  const groups: SingleCondition[][] = [];
  let cur: SingleCondition[] = [conditions[0]];
  for (let i = 0; i < conditions.length - 1; i++) {
    if (conditions[i].nextLogicalOperator === "AND") {
      cur.push(conditions[i + 1]);
    } else {
      groups.push(cur);
      cur = [conditions[i + 1]];
    }
  }
  groups.push(cur);
  return groups;
};

// Rebuild the flat condition list from grouped structure: conditions inside a
// group are AND-connected; the last condition of each non-final group is OR
// (the boundary to the next group). Drops empty groups.
const flattenGroups = (groups: SingleCondition[][]): SingleCondition[] => {
  const nonEmpty = groups.filter((g) => g.length > 0);
  const out: SingleCondition[] = [];
  nonEmpty.forEach((group, gi) => {
    group.forEach((cond, ci) => {
      const lastInGroup = ci === group.length - 1;
      const lastGroup = gi === nonEmpty.length - 1;
      out.push({ ...cond, nextLogicalOperator: lastInGroup && !lastGroup ? "OR" : "AND" });
    });
  });
  return out;
};

// Derive the dnd container map ("g0","g1"… -> condition ids) from a flat list.
const containersFromConditions = (conds: SingleCondition[]): Record<string, string[]> => {
  const obj: Record<string, string[]> = {};
  computeVisualGroups(conds).forEach((grp, i) => {
    obj[`g${i}`] = grp.map((c) => c.id);
  });
  return obj;
};

// ── Main Component ───────────────────────────────────────────

const OPERATORS = ["<", ">", "<=", ">=", "==", "!="];

export function MultiConditionBuilder({
  blockName,
  conditionGroup,
  setConditionGroup,
  registry,
  availableTimeframes,
  executionTimeframe,
}: {
  blockName: string;
  conditionGroup: ConditionGroup;
  setConditionGroup: (group: ConditionGroup) => void;
  registry: Registry;
  availableTimeframes?: string[];
  executionTimeframe?: string;
}) {
  // "adding" state: null = idle, "left" = picking left side, "right" = picking operator + right side
  const [adding, setAdding] = useState<"left" | "right" | null>(null);
  const [pendingLeft, setPendingLeft] = useState<ConditionSide | null>(null);
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  // Which group the add-flow targets. A value >= groups.length means "new OR group".
  const [addTarget, setAddTarget] = useState<number | null>(null);
  const isOpen = blockName === "OPEN";
  const hasConditions = conditionGroup.conditions.length > 0;
  const groups = computeVisualGroups(conditionGroup.conditions);

  // ── Drag-and-drop (dnd-kit) ──
  const byId = useMemo(
    () => new Map(conditionGroup.conditions.map((c) => [c.id, c])),
    [conditionGroup.conditions],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [containers, setContainers] = useState<Record<string, string[]>>(() =>
    containersFromConditions(conditionGroup.conditions),
  );
  const containersRef = useRef(containers);
  containersRef.current = containers;
  useEffect(() => {
    if (activeId === null) setContainers(containersFromConditions(conditionGroup.conditions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionGroup.conditions, activeId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const findContainer = (id: string) =>
    id in containersRef.current
      ? id
      : Object.keys(containersRef.current).find((k) => containersRef.current[k].includes(id)) ?? null;

  const commitGroups = (g: SingleCondition[][]) => {
    setConditionGroup({ conditions: flattenGroups(g) });
  };

  const resetAdd = () => {
    setAdding(null);
    setPendingLeft(null);
    setPendingOp(null);
    setAddTarget(null);
  };

  const startAdd = (target: number) => {
    setAddTarget(target);
    setPendingLeft(null);
    setPendingOp(null);
    setAdding("left");
  };

  const addConditionFromParts = (left: ConditionSide, op: string, right: ConditionSide) => {
    const cond: SingleCondition = { id: generateId(), left, operator: op, right, nextLogicalOperator: "AND" };
    const target = addTarget ?? groups.length;
    const next = groups.map((grp) => [...grp]);
    if (target >= next.length) next.push([cond]);
    else next[target].push(cond);
    commitGroups(next);
    resetAdd();
  };

  const updateCondition = (id: string, updated: SingleCondition) => {
    setConditionGroup({
      conditions: conditionGroup.conditions.map((c) => (c.id === id ? updated : c)),
    });
  };

  const removeCondition = (id: string) => {
    commitGroups(groups.map((grp) => grp.filter((c) => c.id !== id)));
  };

  const commitFromContainers = (conts: Record<string, string[]>) => {
    const newGroups = Object.keys(conts)
      .map((k) => conts[k].map((id) => byId.get(id)).filter(Boolean) as SingleCondition[])
      .filter((g) => g.length > 0);
    commitGroups(newGroups);
  };

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    const activeC = findContainer(activeIdStr);
    const overC = overIdStr in containersRef.current ? overIdStr : findContainer(overIdStr);
    if (!activeC || !overC || activeC === overC) return;
    setContainers((prev) => {
      const activeItems = prev[activeC];
      const overItems = prev[overC];
      const overIndex = overItems.indexOf(overIdStr);
      const newIndex = overIdStr in prev ? overItems.length : overIndex >= 0 ? overIndex : overItems.length;
      return {
        ...prev,
        [activeC]: activeItems.filter((id) => id !== activeIdStr),
        [overC]: [...overItems.slice(0, newIndex), activeIdStr, ...overItems.slice(newIndex)],
      };
    });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    let finalContainers = { ...containersRef.current };
    if (over) {
      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);
      const activeC = findContainer(activeIdStr);
      const overC = overIdStr in finalContainers ? overIdStr : findContainer(overIdStr);
      if (activeC && overC && activeC === overC) {
        const items = finalContainers[activeC];
        const oldIndex = items.indexOf(activeIdStr);
        const newIndex = overIdStr in finalContainers ? items.length - 1 : items.indexOf(overIdStr);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          finalContainers = { ...finalContainers, [activeC]: arrayMove(items, oldIndex, newIndex) };
        }
      }
    }
    setActiveId(null);
    setContainers(finalContainers);
    commitFromContainers(finalContainers);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setContainers(containersFromConditions(conditionGroup.conditions));
  };

  const logicPreview = generateLogicPreview(conditionGroup.conditions);

  // The inline "pick left → pick operator → pick right" builder (no confirm).
  const renderInlineBuilder = () => (
    <motion.div
      key="inline-builder"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12 }}
      className="rounded-lg border border-border bg-background/60 p-2 space-y-1.5"
    >
      {adding === "left" && (
        <IndicatorCommandPalette
          registry={registry}
          onSelect={(side) => {
            setPendingLeft(side);
            setAdding("right");
            setPendingOp("<");
          }}
          onCancel={resetAdd}
          availableTimeframes={availableTimeframes}
          executionTimeframe={executionTimeframe}
        />
      )}
      {adding === "right" && pendingLeft && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px] font-mono font-medium">
              {formatSideLabel(pendingLeft)}
            </span>
            {pendingOp && (
              <span className="px-1.5 py-0.5 rounded bg-secondary text-foreground text-[11px] font-mono">{pendingOp}</span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {OPERATORS.map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => setPendingOp(op)}
                className={`px-2 py-1 rounded border font-mono text-[11px] transition-colors ${
                  pendingOp === op
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-secondary/50 hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {op}
              </button>
            ))}
            <button
              type="button"
              onClick={resetAdd}
              className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
          {pendingOp && (
            <IndicatorCommandPalette
              registry={registry}
              onSelect={(right) => addConditionFromParts(pendingLeft, pendingOp, right)}
              onCancel={resetAdd}
              placeholder="Pick right side..."
              availableTimeframes={availableTimeframes}
              executionTimeframe={executionTimeframe}
            />
          )}
        </div>
      )}
    </motion.div>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-2">
        {Object.keys(containers).map((cid, gi) => {
          const ids = containers[cid];
          return (
            <div key={cid}>
              {gi > 0 && (
                <div className="flex items-center py-1">
                  <div className="flex-1 h-px bg-warning/30" />
                  <span className="mx-2 px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-warning/15 text-warning border border-warning/30">
                    OR
                  </span>
                  <div className="flex-1 h-px bg-warning/30" />
                </div>
              )}
              <GroupDropZone id={cid} isOpen={isOpen}>
                <div className="mb-1.5 px-0.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  Group {gi + 1} · ALL of these <span className="text-primary/70">(AND)</span>
                </div>
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {ids.map((id, ci) => {
                      const cond = byId.get(id);
                      if (!cond) return null;
                      return (
                        <SortableCondition
                          key={id}
                          id={id}
                          ci={ci}
                          condition={cond}
                          registry={registry}
                          isOpen={isOpen}
                          availableTimeframes={availableTimeframes}
                          executionTimeframe={executionTimeframe}
                          onChange={(updated) => updateCondition(id, updated)}
                          onRemove={() => removeCondition(id)}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
                {adding !== null && addTarget === gi ? (
                  <div className="mt-1.5">{renderInlineBuilder()}</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startAdd(gi)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="h-2.5 w-2.5" /> Add condition
                  </button>
                )}
              </GroupDropZone>
            </div>
          );
        })}

        {/* New OR group / first condition */}
        {adding !== null && (addTarget === null || addTarget >= groups.length) ? (
          renderInlineBuilder()
        ) : hasConditions ? (
          <button
            type="button"
            onClick={() => startAdd(groups.length)}
            className="inline-flex items-center gap-1 text-[11px] text-warning/80 hover:text-warning transition-colors"
          >
            <Plus className="h-2.5 w-2.5" /> Add OR group
          </button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => startAdd(0)}
            className={`w-full h-8 border-dashed text-xs ${
              isOpen
                ? "border-success/30 text-success hover:bg-success/10 hover:border-success/50"
                : "border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
            }`}
          >
            <Plus className="h-3 w-3 mr-1" /> Add your first condition
          </Button>
        )}

        {/* Logic Preview */}
        {conditionGroup.conditions.length >= 2 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="px-2 py-1 rounded bg-muted/40 border border-border"
          >
            <div className="flex items-start gap-1.5">
              <span className="text-[10px] text-muted-foreground font-medium shrink-0">Logic:</span>
              <code className="text-[10px] font-mono text-foreground break-all">{logicPreview}</code>
            </div>
          </motion.div>
        )}
      </div>

      {/* Floating card that follows the cursor while dragging */}
      <DragOverlay dropAnimation={null}>
        {activeId && byId.get(activeId) ? (
          <div className="flex items-center gap-2 rounded-lg border border-primary/60 bg-secondary/90 px-3 py-2 text-xs font-mono shadow-xl">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-primary">{formatSideLabel(byId.get(activeId)!.left)}</span>
            <span className="text-foreground">{byId.get(activeId)!.operator}</span>
            <span className="text-primary">{formatSideLabel(byId.get(activeId)!.right)}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ── Drag-and-drop sub-components ─────────────────────────────

function GroupDropZone({ id, isOpen, children }: { id: string; isOpen: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border bg-secondary/10 p-2 transition-colors border-l-2 ${
        isOver ? "border-primary ring-1 ring-primary/40" : "border-border/50"
      } ${isOpen ? "border-l-success/50" : "border-l-destructive/50"}`}
    >
      {children}
    </div>
  );
}

function SortableCondition({
  id,
  ci,
  condition,
  registry,
  isOpen,
  availableTimeframes,
  executionTimeframe,
  onChange,
  onRemove,
}: {
  id: string;
  ci: number;
  condition: SingleCondition;
  registry: Registry;
  isOpen: boolean;
  availableTimeframes?: string[];
  executionTimeframe?: string;
  onChange: (cond: SingleCondition) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {ci > 0 && (
        <div className="flex items-center gap-1.5 py-0.5 pl-6">
          <span className="text-[9px] font-bold text-primary/60">AND</span>
          <div className="flex-1 h-px bg-border/40" />
        </div>
      )}
      <div className="flex items-start gap-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="Drag to reorder or move between groups"
          className="mt-2.5 shrink-0 cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <ConditionRow
            condition={condition}
            onChange={onChange}
            onRemove={onRemove}
            registry={registry}
            isOpen={isOpen}
            availableTimeframes={availableTimeframes}
            executionTimeframe={executionTimeframe}
          />
        </div>
      </div>
    </div>
  );
}

// ── Condition Row — clean read, click to edit ────────────────

function ConditionRow({
  condition,
  onChange,
  onRemove,
  registry,
  isOpen,
  availableTimeframes,
  executionTimeframe
}: {
  condition: SingleCondition;
  onChange: (cond: SingleCondition) => void;
  onRemove: () => void;
  registry: Registry;
  isOpen: boolean;
  availableTimeframes?: string[];
  executionTimeframe?: string;
}) {
  const [editingSide, setEditingSide] = useState<"left" | "right" | null>(null);
  const [expandedSide, setExpandedSide] = useState<"left" | "right" | null>(null);

  const cycleOperator = () => {
    const idx = OPERATORS.indexOf(condition.operator);
    const next = OPERATORS[(idx + 1) % OPERATORS.length];
    onChange({ ...condition, operator: next });
  };

  const handleSideClick = (side: "left" | "right") => {
    const sideData = side === "left" ? condition.left : condition.right;
    if (sideData.type === "indicator") {
      // Toggle expand for args
      setExpandedSide(expandedSide === side ? null : side);
    }
    // Value inline editing is handled by SideDisplay
  };

  const handleReplace = (side: "left" | "right") => {
    setEditingSide(side);
    setExpandedSide(null);
  };

  return (
    <div
      className={`group rounded-lg bg-secondary/20 border border-border/30 hover:border-border/50 transition-colors border-l-2 ${
        isOpen ? "border-l-success/50" : "border-l-destructive/50"
      }`}
    >
      {/* Main row — clean readable line */}
      <div className="flex items-center gap-3 px-4 py-2">
        {editingSide === "left" ? (
          <div className="flex-1 min-w-[180px]">
            <IndicatorCommandPalette
              registry={registry}
              onSelect={(newSide) => {
                onChange({ ...condition, left: newSide });
                setEditingSide(null);
              }}
              onCancel={() => setEditingSide(null)}
              availableTimeframes={availableTimeframes}
              executionTimeframe={executionTimeframe}
            />
          </div>
        ) : (
          <SideDisplay
            side={condition.left}
            onChange={(left) => onChange({ ...condition, left })}
            onClick={() => handleSideClick("left")}
            isExpanded={expandedSide === "left"}
          />
        )}

        <button
          type="button"
          onClick={cycleOperator}
          className="px-3 py-1 rounded-md border border-border/60 bg-muted/50 font-mono text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-border hover:bg-secondary transition-all whitespace-nowrap cursor-pointer shrink-0 inline-flex items-center gap-1"
          title="Click to cycle operator"
        >
          <span>{condition.operator}</span>
          <ChevronsUpDown className="h-2.5 w-2.5 opacity-40" />
        </button>

        {editingSide === "right" ? (
          <div className="flex-1 min-w-[180px]">
            <IndicatorCommandPalette
              registry={registry}
              onSelect={(newSide) => {
                onChange({ ...condition, right: newSide });
                setEditingSide(null);
              }}
              onCancel={() => setEditingSide(null)}
              availableTimeframes={availableTimeframes}
              executionTimeframe={executionTimeframe}
            />
          </div>
        ) : (
          <SideDisplay
            side={condition.right}
            onChange={(right) => onChange({ ...condition, right })}
            onClick={() => handleSideClick("right")}
            isExpanded={expandedSide === "right"}
          />
        )}

        <button
          type="button"
          onClick={() => onChange({ ...condition, left: condition.right, right: condition.left })}
          className="h-6 w-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shrink-0"
          title="Swap left and right"
        >
          <ArrowLeftRight className="h-3 w-3" />
        </button>

        <button
          type="button"
          onClick={onRemove}
          className="h-6 w-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded args editor — slides below when indicator clicked */}
      <AnimatePresence>
        {expandedSide && (
          <ExpandedArgsEditor
            side={expandedSide === "left" ? condition.left : condition.right}
            onChange={(updated) =>
              onChange(
                expandedSide === "left"
                  ? { ...condition, left: updated }
                  : { ...condition, right: updated }
              )
            }
            onReplace={() => handleReplace(expandedSide)}
            onClose={() => setExpandedSide(null)}
            registry={registry}
            availableTimeframes={availableTimeframes}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Side Display — clean label, click to interact ────────────

const MATH_OPERATORS = ["+", "-", "*", "/"] as const;

function SideDisplay({
  side,
  onChange,
  onClick,
  isExpanded,
}: {
  side: ConditionSide;
  onChange: (side: ConditionSide) => void;
  onClick: () => void;
  isExpanded: boolean;
}) {
  const [editingValue, setEditingValue] = useState(false);
  const [showMath, setShowMath] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingValue && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingValue]);

  const mathUI = showMath && (
    <div className="flex items-center gap-1 mt-1">
      <div className="flex items-center gap-0.5">
        {MATH_OPERATORS.map((op) => (
          <button
            key={op}
            type="button"
            onClick={() => {
              const current = side.operation;
              onChange({
                ...side,
                operation: { operator: op, operand: current?.operand ?? 1 },
              });
            }}
            className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-mono font-bold transition-colors ${
              side.operation?.operator === op
                ? "bg-primary/15 text-primary border border-primary/30"
                : "bg-secondary/50 text-muted-foreground border border-border/50 hover:text-foreground"
            }`}
          >
            {op}
          </button>
        ))}
      </div>
      <input
        type="number"
        value={side.operation?.operand ?? 1}
        onChange={(e) =>
          onChange({
            ...side,
            operation: {
              operator: side.operation?.operator || "+",
              operand: parseFloat(e.target.value) || 0,
            },
          })
        }
        className="h-5 w-14 px-1 rounded border border-border/50 bg-background text-[11px] font-mono text-foreground outline-none focus:border-primary/50"
      />
      {side.operation && (
        <button
          type="button"
          onClick={() => onChange({ ...side, operation: undefined })}
          className="text-[9px] text-muted-foreground hover:text-destructive transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );

  // Value type — click to inline edit
  if (side.type === "value") {
    if (editingValue) {
      return (
        <div>
          <input
            ref={inputRef}
            type="number"
            value={side.value}
            onChange={(e) => onChange({ ...side, value: parseFloat(e.target.value) || 0 })}
            onBlur={() => setEditingValue(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditingValue(false);
            }}
            className="h-7 w-20 px-2 rounded border border-primary/40 bg-background text-xs font-mono text-foreground outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
          />
          {mathUI}
        </div>
      );
    }
    return (
      <div className="group/side flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setEditingValue(true)}
          className="px-2 py-1 rounded font-mono text-xs font-semibold text-foreground border-b border-dashed border-muted-foreground/30 hover:bg-accent/50 transition-colors cursor-text"
          title="Click to edit value"
        >
          {formatSideLabel(side)}
        </button>
        <button
          type="button"
          onClick={() => setShowMath(!showMath)}
          className={`h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover/side:opacity-100 transition-all ${
            side.operation || showMath
              ? "opacity-100 text-primary bg-primary/10"
              : "text-muted-foreground hover:text-primary hover:bg-primary/10"
          }`}
          title="Add math operation"
        >
          <Calculator className="h-2.5 w-2.5" />
        </button>
        {(showMath || side.operation) && mathUI}
      </div>
    );
  }

  // Indicator type — clean label like RSI(14, 1h)
  return (
    <div className="group/side flex items-center gap-0.5">
      <button
        type="button"
        onClick={onClick}
        className={`px-2 py-1 rounded font-mono text-[12px] font-semibold transition-colors cursor-pointer ${
          isExpanded
            ? "bg-primary/15 text-primary"
            : "text-foreground border-b border-dashed border-muted-foreground/30 hover:bg-accent/50"
        }`}
        title="Click to edit parameters"
      >
        {formatSideLabel(side)}
      </button>
      <button
        type="button"
        onClick={() => setShowMath(!showMath)}
        className={`h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover/side:opacity-100 transition-all ${
          side.operation || showMath
            ? "opacity-100 text-primary bg-primary/10"
            : "text-muted-foreground hover:text-primary hover:bg-primary/10"
        }`}
        title="Add math operation"
      >
        <Calculator className="h-2.5 w-2.5" />
      </button>
      {(showMath || side.operation) && mathUI}
    </div>
  );
}

// ── Expanded Args Editor — appears below the row ─────────────

function ExpandedArgsEditor({
  side,
  onChange,
  onReplace,
  onClose,
  registry,
  availableTimeframes,
}: {
  side: ConditionSide;
  onChange: (side: ConditionSide) => void;
  onReplace: () => void;
  onClose: () => void;
  registry: Registry;
  availableTimeframes?: string[];
}) {
  if (side.type !== "indicator") return null;

  const ind = registry.indicators.INDICATORS[side.func];
  const argKeys = ind?.args || [];
  const meta = INDICATOR_META[side.func];

  if (argKeys.length === 0) return null;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="overflow-hidden"
    >
      <div className="px-4 pb-2.5 pt-0.5">
        <div className="flex items-center gap-2 bg-muted/40 rounded-md px-3 py-2 flex-wrap">
          {meta && (
            <span className="text-[10px] text-muted-foreground mr-1">{meta.description}</span>
          )}
          {argKeys.map((param: string) => {
            const val = side.args[param];

            if (param === "field" || param === "OHLC") {
              return (
                <div key={param} className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground font-medium">{param}:</span>
                  <select
                    value={String(val)}
                    onChange={(e) =>
                      onChange({ ...side, args: { ...side.args, [param]: e.target.value } })
                    }
                    className="h-6 px-1.5 rounded border border-border/50 bg-background text-[11px] font-mono text-foreground outline-none focus:border-primary/50 transition-colors cursor-pointer"
                  >
                    {["open", "high", "low", "close"].map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
              );
            }

            if (param === "timeframe") {
              return (
                <div key={param} className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground font-medium">{param}:</span>
                  <select
                    value={String(val)}
                    onChange={(e) =>
                      onChange({ ...side, args: { ...side.args, [param]: e.target.value } })
                    }
                    className="h-6 px-1.5 rounded border border-border/50 bg-background text-[11px] font-mono text-foreground outline-none focus:border-primary/50 transition-colors cursor-pointer"
                  >
                    {(availableTimeframes && availableTimeframes.length > 0
                      ? availableTimeframes
                      : ["1m", "5m", "15m", "1h", "4h", "1d"]
                    ).map((tf) => (
                      <option key={tf} value={tf}>{tf}</option>
                    ))}
                  </select>
                </div>
              );
            }

            const domain = getParamDomain(param);
            return (
              <div key={param} className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground font-medium">{param}:</span>
                <input
                  type="number"
                  min={domain?.min}
                  max={domain?.max}
                  step={domain?.integer ? 1 : "any"}
                  value={val as number}
                  onChange={(e) =>
                    onChange({
                      ...side,
                      args: { ...side.args, [param]: parseFloat(e.target.value) || 0 },
                    })
                  }
                  onBlur={() => {
                    const clamped = clampToDomain(Number(val) || 0, domain);
                    if (clamped !== val) {
                      onChange({ ...side, args: { ...side.args, [param]: clamped } });
                    }
                  }}
                  className="h-6 w-14 px-1.5 rounded border border-border/50 bg-background text-[11px] font-mono text-foreground outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            );
          })}

          <button
            type="button"
            onClick={onReplace}
            className="ml-auto text-[10px] text-muted-foreground hover:text-primary hover:underline transition-colors"
          >
            change
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            done
          </button>
        </div>
      </div>
    </motion.div>
  );
}
