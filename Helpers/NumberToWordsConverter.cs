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

        public static string Convert(decimal amount)
        {
            if (amount == 0) return "Zero Rupees Only";

            long rupees = (long)Math.Floor(amount);
            int paisa = (int)Math.Round((amount - rupees) * 100);

            string result = ConvertWholeNumber(rupees) + " Rupees";

            if (paisa > 0)
                result += " and " + ConvertWholeNumber(paisa) + " Paisa";

            return result + " Only";
        }

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
