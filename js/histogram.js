class Histogram {
    static calculateStatistics(histogram) {
        if (!histogram || histogram.length === 0) {
            return { median: null, min: null, max: null, mean: null, total: 0 };
        }

        const total = histogram.reduce((sum, freq) => sum + freq, 0);
        if (total === 0) {
            return { median: null, min: null, max: null, mean: null, total: 0 };
        }

        let min = null;
        let max = null;
        let sum = 0;
        let medianValue = null;
        const half = total / 2;
        let cumulativeFrequency = 0;

        // First pass: find min, max, and calculate sum for mean
        for (let i = 0; i < histogram.length; i++) {
            if (histogram[i] > 0) {
                if (min === null) min = i;
                max = i;
                sum += i * histogram[i];
            }
        }

        // Second pass: find median
        for (let i = 0; i < histogram.length; i++) {
            cumulativeFrequency += histogram[i];
            if (cumulativeFrequency >= half && medianValue === null) {
                // Interpolate for more accurate median
                const prevCumulative = cumulativeFrequency - histogram[i];
                const fraction = (half - prevCumulative) / histogram[i];
                medianValue = i + fraction;
            }
        }

        return {
            median: medianValue,
            min,
            max,
            mean: sum / total,
            total,
            normalizedHistogram: histogram.map(value => value / total)
        };
    }
}

export default Histogram