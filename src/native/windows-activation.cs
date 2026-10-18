using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace CodexWindowsActivation
{
    internal enum ActivateOptions : uint
    {
        None = 0
    }

    [ComImport]
    [Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IApplicationActivationManager
    {
        [PreserveSig]
        int ActivateApplication(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments,
            ActivateOptions options,
            out uint processId);
    }

    [ComImport]
    [Guid("00000001-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IClassFactory
    {
        [PreserveSig]
        int CreateInstance(IntPtr outer, ref Guid riid, out IntPtr instance);

        [PreserveSig]
        int LockServer(bool lockServer);
    }

    public static class Native
    {
        // Keep activation-argument lifetime independent of this short-lived PowerShell host.
        private const uint ClsCtxLocalServer = 0x4;
        private const uint CoinitApartmentThreaded = 0x2;
        private const int RpcEChangedMode = unchecked((int)0x80010106);
        private const int E_FAIL = unchecked((int)0x80004005);
        private const int AppModelErrorNoPackage = 15700;
        private const int ErrorInsufficientBuffer = 122;
        private const uint ProcessQueryLimitedInformation = 0x1000;

        private static readonly Guid ApplicationActivationManagerClsid =
            new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
        private static readonly Guid ApplicationActivationManagerIid =
            new Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D");
        private static readonly Guid ClassFactoryIid =
            new Guid("00000001-0000-0000-C000-000000000046");

        [DllImport("ole32.dll", ExactSpelling = true)]
        private static extern int CoInitializeEx(IntPtr reserved, uint coInit);

        [DllImport("ole32.dll", ExactSpelling = true)]
        private static extern void CoUninitialize();

        [DllImport("ole32.dll", ExactSpelling = true)]
        private static extern int CoCreateInstance(
            ref Guid rclsid,
            IntPtr outer,
            uint clsContext,
            ref Guid riid,
            out IntPtr instance);

        [DllImport("ole32.dll", ExactSpelling = true)]
        private static extern int CoGetClassObject(
            ref Guid rclsid,
            uint clsContext,
            IntPtr reserved,
            ref Guid riid,
            out IntPtr classObject);

        [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);

        [DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern int GetPackageFullName(
            IntPtr process,
            ref uint packageFullNameLength,
            StringBuilder packageFullName);

        public static uint Activate(string appUserModelId, string arguments)
        {
            if (appUserModelId == null) throw new ArgumentNullException("appUserModelId");
            if (arguments == null) throw new ArgumentNullException("arguments");

            int init = CoInitializeEx(IntPtr.Zero, CoinitApartmentThreaded);
            bool uninitialize = init >= 0;
            if (init < 0 && init != RpcEChangedMode) Marshal.ThrowExceptionForHR(init);

            IntPtr unknown = IntPtr.Zero;
            IApplicationActivationManager manager = null;
            try
            {
                Guid clsid = ApplicationActivationManagerClsid;
                Guid iid = ApplicationActivationManagerIid;
                int hr = CoCreateInstance(
                    ref clsid,
                    IntPtr.Zero,
                    ClsCtxLocalServer,
                    ref iid,
                    out unknown);
                if (hr < 0) Marshal.ThrowExceptionForHR(hr);

                manager = (IApplicationActivationManager)Marshal.GetObjectForIUnknown(unknown);
                uint processId;
                hr = manager.ActivateApplication(
                    appUserModelId,
                    arguments,
                    ActivateOptions.None,
                    out processId);
                if (hr < 0) Marshal.ThrowExceptionForHR(hr);
                if (processId == 0)
                    throw new InvalidOperationException("ActivateApplication returned process ID 0.");
                return processId;
            }
            finally
            {
                try
                {
                    if (manager != null) Marshal.ReleaseComObject(manager);
                }
                finally
                {
                    if (unknown != IntPtr.Zero) Marshal.Release(unknown);
                    if (uninitialize) CoUninitialize();
                }
            }
        }

        // Class-factory + QI probe only; never calls ActivateApplication.
        public static string ProbeActivationManager()
        {
            uint clsContext = ClsCtxLocalServer;
            int init = CoInitializeEx(IntPtr.Zero, CoinitApartmentThreaded);
            bool uninitialize = init >= 0;
            if (init < 0 && init != RpcEChangedMode) Marshal.ThrowExceptionForHR(init);

            int factoryResult = E_FAIL;
            int createResult = E_FAIL;
            int queryInterfaceResult = E_FAIL;
            int coCreateResult = E_FAIL;
            int coCreateQueryInterfaceResult = E_FAIL;
            IntPtr factoryPointer = IntPtr.Zero;
            IntPtr instancePointer = IntPtr.Zero;
            IntPtr queriedPointer = IntPtr.Zero;
            IntPtr coCreatePointer = IntPtr.Zero;
            IntPtr coCreateQueriedPointer = IntPtr.Zero;
            IClassFactory factory = null;
            try
            {
                Guid clsid = ApplicationActivationManagerClsid;
                Guid factoryIid = ClassFactoryIid;
                factoryResult = CoGetClassObject(
                    ref clsid,
                    clsContext,
                    IntPtr.Zero,
                    ref factoryIid,
                    out factoryPointer);
                if (factoryResult >= 0)
                {
                    factory = (IClassFactory)Marshal.GetObjectForIUnknown(factoryPointer);
                    Guid activationIid = ApplicationActivationManagerIid;
                    createResult = factory.CreateInstance(
                        IntPtr.Zero,
                        ref activationIid,
                        out instancePointer);
                    if (createResult >= 0 && instancePointer != IntPtr.Zero)
                    {
                        activationIid = ApplicationActivationManagerIid;
                        queryInterfaceResult = Marshal.QueryInterface(
                            instancePointer,
                            ref activationIid,
                            out queriedPointer);
                    }
                }

                Guid directClsid = ApplicationActivationManagerClsid;
                Guid directIid = ApplicationActivationManagerIid;
                coCreateResult = CoCreateInstance(
                    ref directClsid,
                    IntPtr.Zero,
                    clsContext,
                    ref directIid,
                    out coCreatePointer);
                if (coCreateResult >= 0 && coCreatePointer != IntPtr.Zero)
                {
                    directIid = ApplicationActivationManagerIid;
                    coCreateQueryInterfaceResult = Marshal.QueryInterface(
                        coCreatePointer,
                        ref directIid,
                        out coCreateQueriedPointer);
                }

                return "factory=" + HResult(factoryResult)
                    + ";create=" + HResult(createResult)
                    + ";qi=" + HResult(queryInterfaceResult)
                    + ";cocreate=" + HResult(coCreateResult)
                    + ";cocreateqi=" + HResult(coCreateQueryInterfaceResult);
            }
            finally
            {
                try
                {
                    if (factory != null) Marshal.ReleaseComObject(factory);
                }
                finally
                {
                    if (coCreateQueriedPointer != IntPtr.Zero)
                        Marshal.Release(coCreateQueriedPointer);
                    if (coCreatePointer != IntPtr.Zero) Marshal.Release(coCreatePointer);
                    if (queriedPointer != IntPtr.Zero) Marshal.Release(queriedPointer);
                    if (instancePointer != IntPtr.Zero) Marshal.Release(instancePointer);
                    if (factoryPointer != IntPtr.Zero) Marshal.Release(factoryPointer);
                    if (uninitialize) CoUninitialize();
                }
            }
        }

        private static string HResult(int value)
        {
            return "0x" + unchecked((uint)value).ToString("X8");
        }

        public static bool TryGetPackageFullName(uint processId, out string packageFullName)
        {
            if (processId == 0) throw new ArgumentOutOfRangeException("processId");

            IntPtr process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
            if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());

            try
            {
                uint length = 0;
                int result = GetPackageFullName(process, ref length, null);
                if (result == AppModelErrorNoPackage)
                {
                    packageFullName = null;
                    return false;
                }
                if (result != ErrorInsufficientBuffer) throw new Win32Exception(result);

                var buffer = new StringBuilder((int)length);
                result = GetPackageFullName(process, ref length, buffer);
                if (result == AppModelErrorNoPackage)
                {
                    packageFullName = null;
                    return false;
                }
                if (result != 0) throw new Win32Exception(result);

                packageFullName = buffer.ToString();
                return true;
            }
            finally
            {
                CloseHandle(process);
            }
        }
    }
}
