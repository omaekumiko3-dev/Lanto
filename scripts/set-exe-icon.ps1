param([Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string]$Icon)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class LantoExecutableIcon {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string file, bool delete);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr handle, bool discard);
  public static void Set(string executable, string icon) {
    byte[] bytes = File.ReadAllBytes(icon);
    using(var reader = new BinaryReader(new MemoryStream(bytes))) {
      if(reader.ReadUInt16()!=0 || reader.ReadUInt16()!=1) throw new InvalidDataException("Not an ICO");
      ushort count = reader.ReadUInt16();
      if(count==0 || count>64) throw new InvalidDataException("Invalid ICO count");
      IntPtr handle = BeginUpdateResource(executable,false);
      if(handle==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
      bool committed=false;
      try {
        using(var memory = new MemoryStream()) using(var group = new BinaryWriter(memory)) {
          group.Write((ushort)0);group.Write((ushort)1);group.Write(count);
          for(ushort i=0;i<count;i++) {
            byte[] entry=reader.ReadBytes(12); uint size=BitConverter.ToUInt32(entry,8);uint offset=reader.ReadUInt32();
            if(offset+size>bytes.Length) throw new InvalidDataException("ICO exceeds file");
            byte[] image=new byte[size];Buffer.BlockCopy(bytes,(int)offset,image,0,(int)size);
            if(!UpdateResource(handle,(IntPtr)3,(IntPtr)(i+1),1033,image,size))throw new System.ComponentModel.Win32Exception();
            group.Write(entry);group.Write((ushort)(i+1));
          }
          byte[] data=memory.ToArray();
          if(!UpdateResource(handle,(IntPtr)14,(IntPtr)1,1033,data,(uint)data.Length))throw new System.ComponentModel.Win32Exception();
        }
        if(!EndUpdateResource(handle,false)) throw new System.ComponentModel.Win32Exception();
        committed=true;
      } finally { if(!committed)EndUpdateResource(handle,true); }
    }
  }
}
'@
[LantoExecutableIcon]::Set((Resolve-Path -LiteralPath $Executable).Path,(Resolve-Path -LiteralPath $Icon).Path)
