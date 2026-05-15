//Runs nvidia-smi on our local computer
//child-process lets us run terminal commands from inside our code

import { execSync } from "child_process";

//TYPES - Shape of the data

export interface GpuStats {
    name: string;
    temperatureC: number;
    powerUsageW: number;
    powerCapW: number;
    memoryUsedMiB: number;
    memoryTotalMiB: number;          // fixed: MiB not Mib
    gpuUtilizationPercent: number;
    driverVersion: string;           // fixed: string, has dots ("550.54.15")
    cudaVersion: string;             // fixed: string, has dots ("12.4")
}

export interface GpuProcess {
    pid: number;
    name: string;
}

export interface FullGpuReport {
    gpu: GpuStats;
    processes: GpuProcess[];
    timestamp: string;
}

//TOOL FUNCTIONALITY

export function getGpuStats(): FullGpuReport {
    const raw: string = execSync("nvidia-smi").toString();   // fixed: execSync

    // ---- PARSE GPU STATUS -----

    const nameMatch = raw.match(/\|\s+0\s+(.+?)\s{2,}/);
    const name: string = nameMatch ? nameMatch[1].trim() : "Unknown GPU";

    const tempMatch = raw.match(/(\d+)C\s+P\d/);
    const temperatureC: number = tempMatch ? parseInt(tempMatch[1]) : 0;

    const powerMatch = raw.match(/(\d+)W\s*\/\s*(\d+)W/);
    const powerUsageW: number = powerMatch ? parseInt(powerMatch[1]) : 0;
    const powerCapW: number = powerMatch ? parseInt(powerMatch[2]) : 0;

    const memMatch = raw.match(/(\d+)MiB\s*\/\s*(\d+)MiB/);
    const memoryUsedMiB: number = memMatch ? parseInt(memMatch[1]) : 0;
    const memoryTotalMiB: number = memMatch ? parseInt(memMatch[2]) : 0;

    const utilMatch = raw.match(/(\d+)%\s+Default/);
    const gpuUtilizationPercent: number = utilMatch ? parseInt(utilMatch[1]) : 0;

    const driverMatch = raw.match(/Driver Version:\s+([\d.]+)/);
    const driverVersion: string = driverMatch ? driverMatch[1] : "Unknown";

    const cudaMatch = raw.match(/CUDA Version:\s+([\d.]+)/);
    const cudaVersion: string = cudaMatch ? cudaMatch[1] : "Unknown";

    //PARSE RUNNING processes

    const processes: GpuProcess[] = [];
    const lines: string[] = raw.split("\n");

    for (const line of lines) {
        const processMatch = line.match(/\|\s+\d+\s+N\/A\s+N\/A\s+(\d+)\s+\S+\s+(.+?)\s{2,}/);
        if (processMatch) {
            processes.push({
                pid: parseInt(processMatch[1]),
                name: processMatch[2].trim().split("\\").pop() || processMatch[2].trim(),
            });
        }
    }

    return {
        gpu: {
            name,
            temperatureC,
            powerUsageW,
            powerCapW,
            memoryTotalMiB,           // fixed: MiB
            memoryUsedMiB,
            gpuUtilizationPercent,
            driverVersion,
            cudaVersion,
        },
        processes,
        timestamp: new Date().toISOString(),
    };
}

const report = getGpuStats();

console.log("\n=== GPU Stats ===");
console.log(JSON.stringify(report.gpu, null, 2));

console.log("\n=== GPU Processes ===");
for (const proc of report.processes) {
    console.log(`  PID ${proc.pid}: ${proc.name}`);
}
console.log(`\nTimestamp: ${report.timestamp}`);
console.log(`Processes using GPU: ${report.processes.length}`);
console.log(`Memory pressure: ${Math.round((report.gpu.memoryUsedMiB / report.gpu.memoryTotalMiB) * 100)}%`);