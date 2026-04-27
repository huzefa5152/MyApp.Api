namespace MyApp.Api.Helpers
{
    public static class NumberToWordsConverter
    {
        private static readonly string[] Ones =
        {
            "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
            "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
            "Seventeen", "Eighteen", "Nineteen"
        };

        private static readonly string[] Tens =
        {
            "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
        };

        // FBR / commercial-invoice convention in Pakistan: amount-in-words shows
        // whole rupees only with standard half-up rounding so the value matches
        // the rounded grand total printed on the same invoice. Paisa is dropped
        // from both. Examples:
        //   10.10  → "Ten Rupees Only"     (display: Rs. 10)
        //   10.50  → "Eleven Rupees Only"  (display: Rs. 11)
        //   10.99  → "Eleven Rupees Only"  (display: Rs. 11)
        // Use RoundForDisplay() below to round the same way wherever the grand
        // total is shown on a printed bill — keeps the number and the words in
        // sync end-to-end.
        public static string Convert(decimal amount)
        {
            if (amount <= 0) return "Zero Rupees Only";

            long rupees = (long)RoundForDisplay(amount);
            return ConvertWholeNumber(rupees) + " Rupees Only";
        }

        /// <summary>
        /// Standard half-up rounding to whole rupees — the canonical rounding
        /// for printed-bill display. Use this everywhere the grand total /
        /// totals are rendered for the operator's eye, so the printed number
        /// and the in-words line never drift apart.
        /// </summary>
        public static decimal RoundForDisplay(decimal amount)
            => Math.Round(amount, 0, MidpointRounding.AwayFromZero);

        private static string ConvertWholeNumber(long number)
        {
            if (number == 0) return "Zero";
            if (number < 0) return "Minus " + ConvertWholeNumber(-number);

            string words = "";

            if (number / 10000000 > 0)
            {
                words += ConvertWholeNumber(number / 10000000) + " Crore ";
                number %= 10000000;
            }

            if (number / 100000 > 0)
            {
                words += ConvertWholeNumber(number / 100000) + " Lac ";
                number %= 100000;
            }

            if (number / 1000 > 0)
            {
                words += ConvertWholeNumber(number / 1000) + " Thousand ";
                number %= 1000;
            }

            if (number / 100 > 0)
            {
                words += ConvertWholeNumber(number / 100) + " Hundred ";
                number %= 100;
            }

            if (number > 0)
            {
                if (number < 20)
                    words += Ones[number];
                else
                {
                    words += Tens[number / 10];
                    if (number % 10 > 0)
                        words += " " + Ones[number % 10];
                }
            }

            return words.Trim();
        }
    }
}
