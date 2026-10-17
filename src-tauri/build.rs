fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-darwin") {
        println!("cargo:rerun-if-changed=native/voice_macos.m");
        println!("cargo:rerun-if-changed=native/voice_macos.h");
        println!("cargo:rustc-link-lib=framework=Speech");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=Foundation");
        cc::Build::new()
            .file("native/voice_macos.m")
            .flag("-fobjc-arc")
            .include("native")
            .compile("mob_voice");
    }
    tauri_build::build()
}
