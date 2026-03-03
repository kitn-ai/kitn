/** @jsxImportSource react */
import React, { useState } from "react";
import { Box, Text } from "ink";
import { Select, ConfirmInput, MultiSelect, TextInput } from "@inkjs/ui";
import { Spinner } from "@inkjs/ui";
import type { ChatPlan, PlanStep } from "../../chat-types.js";
import {
  formatPlan,
  formatStepLabel,
  executeStep,
  validatePlan,
} from "../../chat-engine.js";

interface PlanViewProps {
  plan: ChatPlan;
  cwd: string;
  availableComponents: string[];
  installedComponents: string[];
  onComplete: (result: string) => void;
}

type Phase =
  | { type: "validate" }
  | { type: "confirm-single" }
  | { type: "choose-mode" }
  | { type: "select-steps" }
  | { type: "file-exists"; stepIndex: number; stepName: string }
  | { type: "rename"; stepIndex: number }
  | { type: "executing"; stepIndex: number; total: number; label: string }
  | { type: "done" };

export function PlanView({ plan, cwd, availableComponents, installedComponents, onComplete }: PlanViewProps) {
  const [phase, setPhase] = useState<Phase>(() => {
    const errors = validatePlan(plan, availableComponents, installedComponents);
    if (errors.length > 0) {
      // Report validation errors immediately
      setTimeout(() => {
        onComplete(`PLAN VALIDATION FAILED. Fix these issues and call createPlan again:\n${errors.join("\n")}`);
      }, 0);
      return { type: "done" };
    }
    return plan.steps.length === 1 ? { type: "confirm-single" } : { type: "choose-mode" };
  });

  const [selectedSteps, setSelectedSteps] = useState<PlanStep[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [mutableSteps] = useState(() => [...plan.steps]);

  const runSteps = async (steps: PlanStep[]) => {
    const stepResults: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Check file exists for create steps
      if (step.action === "create" && step.type && step.name) {
        const { componentFileExists } = await import("@kitnai/cli-core");
        const existingPath = await componentFileExists(step.type, step.name);
        if (existingPath) {
          setPhase({ type: "file-exists", stepIndex: i, stepName: step.name! });
          // Wait for user to resolve the conflict — they'll call back into execution
          return { paused: true, pausedIndex: i, partialResults: stepResults };
        }
      }

      setPhase({ type: "executing", stepIndex: i, total: steps.length, label: formatStepLabel(step) });
      try {
        await executeStep(step);
        stepResults.push(`Completed: ${step.action} ${step.component ?? step.name ?? ""}`);
      } catch (err: any) {
        stepResults.push(`Failed: ${step.action} ${step.component ?? step.name ?? ""} — ${err.message}`);
      }
    }
    return { paused: false, pausedIndex: -1, partialResults: stepResults };
  };

  const startExecution = async (steps: PlanStep[]) => {
    setSelectedSteps(steps);
    const result = await runSteps(steps);
    if (!result.paused) {
      onComplete(result.partialResults.join("\n"));
    } else {
      setResults(result.partialResults);
    }
  };

  const resumeExecution = async (fromIndex: number, steps: PlanStep[]) => {
    const remainingSteps = steps.slice(fromIndex);
    const result = await runSteps(remainingSteps);
    const allResults = [...results, ...result.partialResults];
    if (!result.paused) {
      onComplete(allResults.join("\n"));
    } else {
      setResults(allResults);
    }
  };

  return (
    <Box flexDirection="column">
      <Text>{formatPlan(plan)}</Text>
      <Text>{""}</Text>

      {phase.type === "done" && null}

      {phase.type === "confirm-single" && (
        <Box>
          <Text>Run: {formatStepLabel(plan.steps[0])}? (Y/n) </Text>
          <ConfirmInput
            onConfirm={() => startExecution(plan.steps)}
            onCancel={() => onComplete("User cancelled the plan.")}
          />
        </Box>
      )}

      {phase.type === "choose-mode" && (
        <Box flexDirection="column">
          <Text bold>How would you like to proceed?</Text>
          <Select
            options={[
              { label: "Yes, run all steps", value: "all" },
              { label: "Select which steps to run", value: "select" },
              { label: "Cancel", value: "cancel" },
            ]}
            onChange={(value) => {
              if (value === "cancel") {
                onComplete("User cancelled the plan.");
              } else if (value === "select") {
                setPhase({ type: "select-steps" });
              } else {
                startExecution(mutableSteps);
              }
            }}
          />
        </Box>
      )}

      {phase.type === "select-steps" && (
        <Box flexDirection="column">
          <Text bold>Select steps to run (Space to toggle, Enter to confirm):</Text>
          <MultiSelect
            options={mutableSteps.map((step, i) => ({
              label: `${formatStepLabel(step)} - ${step.reason}`,
              value: String(i),
            }))}
            onSubmit={(values) => {
              const indices = values.map(Number);
              const steps = indices.map((i) => mutableSteps[i]);
              startExecution(steps);
            }}
          />
        </Box>
      )}

      {phase.type === "file-exists" && (
        <Box flexDirection="column">
          <Text color="yellow">{phase.stepName} already exists. What would you like to do?</Text>
          <Select
            options={[
              { label: "Use a different name", value: "rename" },
              { label: "Overwrite the existing file", value: "overwrite" },
              { label: "Skip this step", value: "skip" },
            ]}
            onChange={(value) => {
              if (value === "skip") {
                const newResults = [...results, `Skipped: create ${phase.stepName} — file already exists`];
                setResults(newResults);
                resumeExecution(phase.stepIndex + 1, selectedSteps);
              } else if (value === "rename") {
                setPhase({ type: "rename", stepIndex: phase.stepIndex });
              } else {
                // Overwrite — continue execution
                resumeExecution(phase.stepIndex, selectedSteps);
              }
            }}
          />
        </Box>
      )}

      {phase.type === "rename" && (
        <Box>
          <Text>New name: </Text>
          <TextInput
            defaultValue={`${selectedSteps[phase.stepIndex].name}-2`}
            onSubmit={(newName) => {
              if (!newName.trim()) {
                const newResults = [...results, `Skipped: create ${selectedSteps[phase.stepIndex].name} — no name provided`];
                setResults(newResults);
                resumeExecution(phase.stepIndex + 1, selectedSteps);
              } else {
                selectedSteps[phase.stepIndex].name = newName.trim();
                resumeExecution(phase.stepIndex, selectedSteps);
              }
            }}
          />
        </Box>
      )}

      {phase.type === "executing" && (
        <Spinner label={`Running (${phase.stepIndex + 1}/${phase.total}): ${phase.label}...`} />
      )}
    </Box>
  );
}
