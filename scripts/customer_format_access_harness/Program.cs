using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
var name="MyApp_ImportChecks_"+Guid.NewGuid().ToString("N");
using var db=new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer($@"Server=.\MSSQLSERVER02;Database={name};Integrated Security=True;TrustServerCertificate=True").Options);
int passed=0;
try {
 await db.Database.MigrateAsync();
 await PoFormatAccessChecks.Run(db,(ok,label)=>{if(!ok)throw new Exception(label);passed++;Console.WriteLine("PASS "+label);});
 Console.WriteLine($"{passed}/{passed} checks passed");
}finally{await db.Database.EnsureDeletedAsync();}
