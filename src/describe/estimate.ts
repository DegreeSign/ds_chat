import { readData, saveData } from '@degreesign/storage';
import { EstimateOperation } from '../types/enums';
import type { EstimateEntry, EstimateReport } from '../types';


let
    /** Measured seconds per operation */
    measured: Partial<Record<EstimateOperation, number>> | undefined;

const
    /** localStorage key of estimates */
    estimateKey = `degreesign-chat-estimates-v1`,
    /** Fallback seconds per operation */
    fallbackSeconds: Record<EstimateOperation, number> = {
        analyze: 95,
        describe: 25,
        translate: 15,
        tags: 6,
        translateTags: 4,
    },
    /** Read measured seconds once */
    measuredSeconds = (): Partial<Record<EstimateOperation, number>> =>
        measured ??= readData<Partial<Record<EstimateOperation, number>>>(
            estimateKey,
        ) ?? {},
    /** Build report of operations */
    estimateReport = (operations: EstimateOperation[]): EstimateReport => {
        const breakdown: EstimateEntry[] = operations.map(operation => ({
            operation,
            est: measuredSeconds()[operation] ?? fallbackSeconds[operation],
        }));
        return {
            totalEst: breakdown.reduce((sum, entry) => sum + entry.est, 0),
            breakdown,
        };
    },
    /** Record one measured operation */
    recordEstimate = ({
        operation,
        seconds,
    }: {
        operation: EstimateOperation,
        seconds: number,
    }): void => {
        if (!(seconds > 0)) return;
        measured = { ...measuredSeconds(), [operation]: seconds };
        saveData({ key: estimateKey, data: measured });
    },
    /** Clear measured estimates */
    resetEstimates = (): void => {
        measured = {};
        saveData({ key: estimateKey });
    };

export { estimateReport, recordEstimate, resetEstimates };
