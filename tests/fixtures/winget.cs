// Native executable fixture: runs real mise's Windows WinGet implementation.
// This models WinGet process I/O; it is not a real package installation test.
using System;
using System.IO;

public class WingetFixture
{
    public static int Main(string[] args)
    {
        File.AppendAllText(Environment.GetEnvironmentVariable("WINGET_TEST_LOG"),
            string.Join(" ", args) + Environment.NewLine);
        if (Environment.GetEnvironmentVariable("WINGET_TEST_FAIL") == "1")
            return 42;
        if (args.Length > 0 && args[0] == "list")
        {
            string id = args[Array.IndexOf(args, "--id") + 1];
            if (id == Environment.GetEnvironmentVariable("WINGET_TEST_MISSING"))
                return unchecked((int)0x8A150014);
            // WinGet matches case-insensitively but returns the canonical ID.
            if (id.Equals("tailscale.tailscale", StringComparison.OrdinalIgnoreCase))
                id = "Tailscale.Tailscale";
            Console.WriteLine("Name Id Version Available Source");
            Console.WriteLine("--------------------------------");
            Console.WriteLine("App " + id + " 999.0 1000.0 winget");
        }
        return 0;
    }
}
