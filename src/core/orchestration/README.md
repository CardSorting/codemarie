# MAS Orchestration Layer

The Orchestration Layer manages parallel multi-agent execution via `StreamPool` and `WorkerStream`. It supports recursive decomposition, human-in-the-loop governance, and real-time status reporting.

## Key Components

### 1. `StreamPool`
The main orchestrator for a "wave" of parallel tasks.
- **Barrier Synchronization**: Ensures all tasks in a wave complete planning before any start acting.
- **Wave Governance**: Triggers human approval requests (`wave_approval`) between planning and acting phases.
- **Recursive Scaling**: Correctly handles sub-pools spawned by decomposed workers.

### 2. `WorkerStream`
manages the lifecycle of an individual agent task.
- **Plan-vs-Act**: Executes a distinct planning phase (with soundness audits) followed by an acting phase.
- **Hierarchical Decomposition**: Automatically spawns child `StreamPool`s for complex plans (5+ actions), creating a swarm tree.
- **Event Reporting**: Reports granular lifecycle events to the `OrchestrationController`.

### 3. `OrchestrationController`
The bridge between the core orchestration logic and the user interface.
- **Event Dispatching**: Routes lifecycle events to registered task callbacks.
- **State Management**: Tracks `SwarmState` (active workers, progress) for the `SwarmDashboard`.

## Swarm Lifecycle Events
The system emits structured `orchestration_event` messages via `CodemarieSay`:
- `wave_start`: Emitted when a wave enters the acting phase. Includes `totalTasks`.
- `wave_complete`: Emitted when all tasks in a wave have finished.
- `worker_start`: Emitted when an individual worker begins acting.
- `worker_complete`: Emitted when a worker finishes its implementation or decomposition.
- `error`: Emitted on task or wave failure.

## Governance & Predictability
- **Wave Approval**: Large swarms require explicit user approval via `codemarie.approveWave`.
- **Swarm Dashboard**: A real-time UI cockpit in the webview tracks overall progress and active workers using the `swarmState` sync protocol.
