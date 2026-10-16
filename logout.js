const {clearSessionCookie}=require("../../lib/adminAuth");
module.exports=async function(req,res){res.setHeader("Cache-Control","no-store");if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Metode tidak diizinkan"});}clearSessionCookie(res);return res.status(200).json({ok:true});};
